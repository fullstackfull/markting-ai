import 'server-only';
import { db } from '@/lib/db';
import type { LedgerRow } from './learning';
import type { Confidence, Risk } from './intelligence/decision-model';
import type { OutcomeClass } from './outcomes';
import type { TimelineEvent, TimelineEventType } from './timeline';

/**
 * Phase 3A/3D/3P — decision history (append-only lifecycle events with immutable linkage to the
 * Phase-0 operation), the effectiveness ledger-row query, and timeline events. All tenant-scoped.
 * Acceptance (ACCEPTED) and provider execution (EXECUTED) are recorded as DISTINCT events, never merged.
 */

export type DecisionStage =
  | 'CREATED' | 'REVIEWED' | 'DISMISSED' | 'ACCEPTED' | 'PREVIEW_REQUESTED' | 'PREVIEWED' | 'APPROVED'
  | 'REJECTED' | 'EXECUTED' | 'EXECUTION_FAILED' | 'EXPIRED' | 'OUTCOME_PENDING' | 'OUTCOME_MEASURED';

export interface DecisionEventInput {
  recommendationId: string;
  stage: DecisionStage;
  accountId?: string;
  entityId?: string;
  pendingOperationId?: string;
  previewDigest?: string;
  actor?: { type: string; id: string };
  modified?: boolean;
  modification?: Record<string, unknown>;
  rejectionReason?: string;
  providerResult?: Record<string, unknown>;
  note?: string;
}

export async function recordDecisionEvent(organizationId: string, e: DecisionEventInput): Promise<void> {
  await db()`
    insert into public.markting_decision_events
      (organization_id, recommendation_id, stage, account_id, entity_id, pending_operation_id, preview_digest,
       actor_type, actor_id, modified, modification, rejection_reason, provider_result, note)
    values
      (${organizationId}, ${e.recommendationId}, ${e.stage}, ${e.accountId ?? null}, ${e.entityId ?? null},
       ${e.pendingOperationId ?? null}, ${e.previewDigest ?? null}, ${e.actor?.type ?? null}, ${e.actor?.id ?? null},
       ${e.modified ?? false}, ${e.modification ? db().json(e.modification as never) : null}, ${e.rejectionReason ?? null},
       ${e.providerResult ? db().json(e.providerResult as never) : null}, ${e.note ?? null})`;
}

export interface DecisionTrace {
  recommendationId: string;
  stages: Array<{ stage: DecisionStage; at: string; pendingOperationId?: string; previewDigest?: string; modified: boolean }>;
  currentStage: DecisionStage | null;
  pendingOperationId: string | null;
  previewDigest: string | null;
}

/** Full chain Recommendation → Preview → Approval → Apply → Provider result, read from facts (3A). */
export async function traceRecommendation(organizationId: string, recommendationId: string): Promise<DecisionTrace> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select stage, pending_operation_id, preview_digest, modified, created_at
    from public.markting_decision_events
    where organization_id = ${organizationId} and recommendation_id = ${recommendationId}
    order by created_at asc`;
  const stages = rows.map((r) => ({ stage: r.stage as DecisionStage, at: new Date(r.createdAt as string).toISOString(), pendingOperationId: (r.pendingOperationId as string) ?? undefined, previewDigest: (r.previewDigest as string) ?? undefined, modified: !!r.modified }));
  const linked = rows.find((r) => r.pendingOperationId);
  return {
    recommendationId, stages,
    currentStage: stages.length ? stages[stages.length - 1]!.stage : null,
    pendingOperationId: (linked?.pendingOperationId as string) ?? null,
    previewDigest: (linked?.previewDigest as string) ?? null,
  };
}

/** Build the effectiveness ledger rows (3D) by joining recommendations + decision events + outcomes. */
export async function effectivenessRows(organizationId: string): Promise<LedgerRow[]> {
  const recs = await db()<Array<{ id: string; category: string; confidence: Confidence; risk: Risk; entityId: string }>>`
    select id, category, confidence, risk, entity_id from public.markting_recommendations where organization_id = ${organizationId}`;
  const events = await db()<Array<{ recommendationId: string; stage: DecisionStage; rejectionReason: string | null }>>`
    select recommendation_id, stage, rejection_reason from public.markting_decision_events where organization_id = ${organizationId}`;
  const outcomes = await db()<Array<{ recommendationId: string; classification: OutcomeClass; windowLabel: string }>>`
    select recommendation_id, classification, window_label from public.markting_recommendation_outcomes where organization_id = ${organizationId}`;

  const byRec = new Map<string, { accepted: boolean; rejected: boolean; executed: boolean; rejectionReason?: string }>();
  for (const ev of events) {
    const cur = byRec.get(ev.recommendationId) ?? { accepted: false, rejected: false, executed: false };
    if (ev.stage === 'ACCEPTED') cur.accepted = true;
    if (ev.stage === 'REJECTED' || ev.stage === 'DISMISSED') { cur.rejected = true; if (ev.rejectionReason) cur.rejectionReason = ev.rejectionReason; }
    if (ev.stage === 'EXECUTED') cur.executed = true;
    byRec.set(ev.recommendationId, cur);
  }
  // Prefer the longest-horizon measured outcome per recommendation.
  const WRANK: Record<string, number> = { '24h': 1, '3d': 2, '7d': 3, '14d': 4 };
  const bestWindow = new Map<string, number>();
  const outcomeByRec = new Map<string, OutcomeClass>();
  for (const o of outcomes) {
    const rank = WRANK[o.windowLabel] ?? 0;
    if (rank >= (bestWindow.get(o.recommendationId) ?? -1)) {
      bestWindow.set(o.recommendationId, rank);
      outcomeByRec.set(o.recommendationId, o.classification);
    }
  }

  return recs.map((r) => {
    const d = byRec.get(r.id) ?? { accepted: false, rejected: false, executed: false };
    return { recommendationId: r.id, category: r.category, provider: r.entityId.split(':')[0], confidence: r.confidence, risk: r.risk, accepted: d.accepted, rejected: d.rejected, executed: d.executed, outcomeClass: outcomeByRec.get(r.id), rejectionReason: d.rejectionReason };
  });
}

export async function recordTimelineEvent(organizationId: string, e: Omit<TimelineEvent, 'summary'> & { summary?: TimelineEvent['summary'] }): Promise<void> {
  await db()`
    insert into public.markting_timeline_events (organization_id, account_id, entity_id, event_type, source, occurred_at, detail)
    values (${organizationId}, ${e.accountId}, ${e.entityId ?? null}, ${e.eventType}, ${e.source}, ${e.occurredAt}, ${db().json((e.detail ?? {}) as never)})`;
}

export async function listTimelineEvents(organizationId: string, accountId: string, sinceIso?: string): Promise<TimelineEvent[]> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select * from public.markting_timeline_events
    where organization_id = ${organizationId} and account_id = ${accountId}
      ${sinceIso ? db()`and occurred_at >= ${sinceIso}` : db()``}
    order by occurred_at asc`;
  return rows.map((r) => ({
    eventType: r.eventType as TimelineEventType, occurredAt: new Date(r.occurredAt as string).toISOString(),
    accountId: r.accountId as string, entityId: (r.entityId as string) ?? undefined, source: r.source as string,
    summary: { en: String((r.detail as Record<string, unknown>)?.summary_en ?? r.eventType), ar: String((r.detail as Record<string, unknown>)?.summary_ar ?? r.eventType) },
    detail: (r.detail as Record<string, unknown>) ?? undefined,
  }));
}
