import 'server-only';
import { db } from '@/lib/db';
import type { OutcomeClass, OutcomeResult } from './outcomes';

/**
 * Phase 3B/3C/3R — before/after outcome snapshots and the durable, idempotent, deduplicated outcome
 * observation job queue. Scheduling state is PERSISTED (no in-memory timer per recommendation). Every
 * row is organization-tagged; all work a job performs is org-scoped (cross-tenant jobs are impossible —
 * a job only ever reads/writes its own organization_id).
 */

export interface BaselineInput {
  recommendationId: string;
  accountId: string;
  entityId: string;
  windowLabel: string;
  baseline: Record<string, unknown>;
  method: string;
  expectedDirection?: string;
  modified?: boolean;
}

/** Capture the structured BEFORE baseline (3B). Idempotent per (rec, window). */
export async function saveBaseline(organizationId: string, b: BaselineInput): Promise<void> {
  await db()`
    insert into public.markting_recommendation_outcomes
      (organization_id, recommendation_id, account_id, entity_id, window_label, baseline, method, expected_direction, modified, classification)
    values
      (${organizationId}, ${b.recommendationId}, ${b.accountId}, ${b.entityId}, ${b.windowLabel},
       ${db().json(b.baseline as never)}, ${b.method}, ${b.expectedDirection ?? null}, ${b.modified ?? false}, 'OUTCOME_PENDING')
    on conflict (organization_id, recommendation_id, window_label) do nothing`;
}

/** Record the measured outcome (3C) onto the pending baseline row. */
export async function recordOutcome(organizationId: string, recommendationId: string, windowLabel: string, result: OutcomeResult, afterWindow: Record<string, unknown>): Promise<void> {
  await db()`
    update public.markting_recommendation_outcomes set
      after_window = ${db().json(afterWindow as never)}, actual_direction = ${result.actualDirection},
      classification = ${result.classification}, contamination = ${db().json(result.contamination as never)},
      causal_stance = ${result.causalStance}, trust = ${result.trust ?? null}, conclusion = ${db().json(result.conclusion as never)},
      observed_at = now(), updated_at = now()
    where organization_id = ${organizationId} and recommendation_id = ${recommendationId} and window_label = ${windowLabel}`;
}

export async function listOutcomes(organizationId: string, opts: { recommendationId?: string } = {}): Promise<Array<Record<string, unknown>>> {
  return db()<Array<Record<string, unknown>>>`
    select * from public.markting_recommendation_outcomes
    where organization_id = ${organizationId}
      ${opts.recommendationId ? db()`and recommendation_id = ${opts.recommendationId}` : db()``}
    order by created_at desc`;
}

// ---- Observation jobs (durable scheduling) ----

export async function scheduleObservation(organizationId: string, recommendationId: string, windowLabel: string, scheduledFor: Date): Promise<void> {
  const dedupKey = `${recommendationId}:${windowLabel}`;
  await db()`
    insert into public.markting_observation_jobs (organization_id, recommendation_id, window_label, scheduled_for, dedup_key)
    values (${organizationId}, ${recommendationId}, ${windowLabel}, ${scheduledFor.toISOString()}, ${dedupKey})
    on conflict (organization_id, dedup_key) do nothing`;
}

export interface ClaimedJob { id: string; organizationId: string; recommendationId: string; windowLabel: string }

/**
 * Atomically claim due jobs (retry-safe, deduplicated). A worker processes all tenants' jobs, but each
 * returned job is organization-tagged and its work must stay within that org (enforced by callers
 * passing `job.organizationId` to every org-scoped read/write). Uses a compare-and-set UPDATE.
 */
export async function claimDueJobs(now: Date, limit = 50): Promise<ClaimedJob[]> {
  const rows = await db()<Array<Record<string, unknown>>>`
    update public.markting_observation_jobs set status = 'running', attempts = attempts + 1, claimed_at = now(), updated_at = now()
    where id in (
      select id from public.markting_observation_jobs
      where status = 'scheduled' and scheduled_for <= ${now.toISOString()}
      order by scheduled_for asc limit ${limit}
      for update skip locked
    )
    returning id, organization_id, recommendation_id, window_label`;
  return rows.map((r) => ({ id: r.id as string, organizationId: r.organizationId as string, recommendationId: r.recommendationId as string, windowLabel: r.windowLabel as string }));
}

export async function completeJob(id: string, status: 'done' | 'failed', error?: string): Promise<void> {
  await db()`update public.markting_observation_jobs set status = ${status}, last_error = ${error ?? null}, updated_at = now() where id = ${id}`;
}

/** Re-arm a failed job for one bounded retry (idempotent; dedup_key unchanged). */
export async function rescheduleJob(id: string, scheduledFor: Date, maxAttempts = 3): Promise<boolean> {
  const rows = await db()<Array<{ id: string }>>`
    update public.markting_observation_jobs set status = 'scheduled', scheduled_for = ${scheduledFor.toISOString()}, updated_at = now()
    where id = ${id} and attempts < ${maxAttempts} returning id`;
  return rows.length > 0;
}

export async function countOutcomes(organizationId: string): Promise<Record<OutcomeClass, number>> {
  const rows = await db()<Array<{ classification: OutcomeClass; count: number }>>`
    select classification, count(*)::int as count from public.markting_recommendation_outcomes
    where organization_id = ${organizationId} group by classification`;
  const out = { OUTCOME_PENDING: 0, POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, INCONCLUSIVE: 0, INSUFFICIENT_DATA: 0, CONTAMINATED: 0 } as Record<OutcomeClass, number>;
  for (const r of rows) out[r.classification] = Number(r.count);
  return out;
}
