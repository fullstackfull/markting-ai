import 'server-only';
import { db } from '@/lib/db';
import type { Recommendation, RecommendationStatus } from './intelligence/decision-model';

/**
 * Phase 2X — persistence for structured recommendations, tenant-scoped on organization_id (every query
 * is org-filtered; the composite key (organization_id, id) prevents cross-tenant id collisions). The
 * store records lifecycle transitions as events. It NEVER stores or executes a provider mutation —
 * only the typed category/action and its evidence. Acceptance records intent; the Phase-0 path writes.
 */

export interface StoredRecommendation extends Recommendation { updatedAt: string }

/** Persist freshly generated recommendations (idempotent per id). Records a `created` event for new rows. */
export async function saveRecommendations(organizationId: string, recs: Recommendation[]): Promise<void> {
  if (recs.length === 0) return;
  for (const r of recs) {
    if (r.organizationId !== organizationId) throw new Error('recommendation organization mismatch'); // defense in depth
    const inserted = await db()<Array<{ id: string }>>`
      insert into public.markting_recommendations
        (id, organization_id, account_id, entity_id, entity_level, entity_name, category, action_type,
         status, confidence, risk, data_trust, expected_impact, diagnosis_type, reasoning, evidence,
         alternatives, requires_human_approval, created_at, updated_at, expires_at)
      values
        (${r.recommendationId}, ${organizationId}, ${r.accountId}, ${r.entityScope.entityId}, ${r.entityScope.entityLevel}, ${r.entityScope.name},
         ${r.category}, ${r.actionType}, ${r.status}, ${r.confidence}, ${r.risk}, ${r.dataTrust}, ${r.expectedImpact},
         ${r.diagnosis.type}, ${db().json(r.reasoning as never)}, ${db().json(r.evidence as never)}, ${db().json(r.alternatives as never)},
         true, ${r.createdAt}, now(), ${r.expiresAt})
      on conflict (organization_id, id) do nothing
      returning id`;
    if (inserted.length > 0) {
      await db()`insert into public.markting_recommendation_events (organization_id, recommendation_id, event)
                 values (${organizationId}, ${r.recommendationId}, 'created')`;
    }
  }
}

export interface ListFilter { status?: RecommendationStatus; entityId?: string; includeExpired?: boolean; limit?: number }

export async function listRecommendations(organizationId: string, filter: ListFilter = {}): Promise<StoredRecommendation[]> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select * from public.markting_recommendations
    where organization_id = ${organizationId}
      ${filter.status ? db()`and status = ${filter.status}` : db()``}
      ${filter.entityId ? db()`and entity_id = ${filter.entityId}` : db()``}
      ${filter.includeExpired ? db()`` : db()`and status <> 'EXPIRED'`}
    order by created_at desc
    limit ${filter.limit ?? 200}`;
  return rows.map(rowToRec);
}

const VALID_TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  DRAFT: ['REVIEWABLE', 'DISMISSED', 'EXPIRED'],
  REVIEWABLE: ['ACCEPTED_FOR_PREVIEW', 'DISMISSED', 'EXPIRED'],
  INSUFFICIENT_EVIDENCE: ['DISMISSED', 'EXPIRED'],
  ACCEPTED_FOR_PREVIEW: ['DISMISSED', 'EXPIRED'],
  DISMISSED: [],
  EXPIRED: [],
};

/**
 * Transition a recommendation's lifecycle status, org-scoped, with a recorded event. Rejects illegal
 * transitions. ACCEPTED_FOR_PREVIEW records that a human chose to take this to the Phase-0 preview
 * path — it does NOT itself mutate any provider state.
 */
export async function transitionRecommendation(
  organizationId: string, recommendationId: string, to: Exclude<RecommendationStatus, 'DRAFT'>,
  actor?: { type: string; id: string }, note?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const rows = await db()<Array<{ status: RecommendationStatus }>>`
    select status from public.markting_recommendations
    where organization_id = ${organizationId} and id = ${recommendationId} limit 1`;
  if (rows.length === 0) return { ok: false, reason: 'not_found' };
  const from = rows[0]!.status;
  if (!VALID_TRANSITIONS[from].includes(to)) return { ok: false, reason: `illegal transition ${from} -> ${to}` };
  await db()`update public.markting_recommendations set status = ${to}, updated_at = now()
             where organization_id = ${organizationId} and id = ${recommendationId}`;
  const event = to === 'ACCEPTED_FOR_PREVIEW' ? 'accepted_for_preview' : to === 'DISMISSED' ? 'dismissed' : to === 'EXPIRED' ? 'expired' : 'reviewed';
  await db()`insert into public.markting_recommendation_events (organization_id, recommendation_id, event, actor_type, actor_id, note)
             values (${organizationId}, ${recommendationId}, ${event}, ${actor?.type ?? null}, ${actor?.id ?? null}, ${note ?? null})`;
  return { ok: true };
}

/** Expire recommendations past their expiry (org-scoped). Returns the count expired. */
export async function expireStaleRecommendations(organizationId: string, now = new Date()): Promise<number> {
  const rows = await db()<Array<{ id: string }>>`
    update public.markting_recommendations set status = 'EXPIRED', updated_at = now()
    where organization_id = ${organizationId} and status in ('DRAFT', 'REVIEWABLE', 'INSUFFICIENT_EVIDENCE') and expires_at < ${now.toISOString()}
    returning id`;
  for (const r of rows) {
    await db()`insert into public.markting_recommendation_events (organization_id, recommendation_id, event)
               values (${organizationId}, ${r.id}, 'expired')`;
  }
  return rows.length;
}

// `db()` applies postgres.camel.column, so SELECT * returns camelCase keys (organizationId, …).
function rowToRec(row: Record<string, unknown>): StoredRecommendation {
  return {
    recommendationId: row.id as string,
    organizationId: row.organizationId as string,
    accountId: row.accountId as string,
    entityScope: { entityId: row.entityId as string, entityLevel: row.entityLevel as StoredRecommendation['entityScope']['entityLevel'], name: row.entityName as string },
    category: row.category as StoredRecommendation['category'],
    actionType: row.actionType as StoredRecommendation['actionType'],
    diagnosis: { type: row.diagnosisType as StoredRecommendation['diagnosis']['type'] } as StoredRecommendation['diagnosis'],
    reasoning: row.reasoning as StoredRecommendation['reasoning'],
    evidence: (row.evidence ?? []) as StoredRecommendation['evidence'],
    confidence: row.confidence as StoredRecommendation['confidence'],
    risk: row.risk as StoredRecommendation['risk'],
    dataTrust: row.dataTrust as StoredRecommendation['dataTrust'],
    expectedImpact: row.expectedImpact as StoredRecommendation['expectedImpact'],
    alternatives: (row.alternatives ?? []) as StoredRecommendation['alternatives'],
    requiresHumanApproval: true,
    status: row.status as RecommendationStatus,
    expiresAt: new Date(row.expiresAt as string).toISOString(),
    createdAt: new Date(row.createdAt as string).toISOString(),
    updatedAt: new Date(row.updatedAt as string).toISOString(),
  };
}
