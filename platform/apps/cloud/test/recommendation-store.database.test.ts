import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { saveRecommendations, listRecommendations, transitionRecommendation, expireStaleRecommendations } from '@/lib/markting/recommendation-store';
import type { Recommendation } from '@/lib/markting/intelligence/decision-model';
import type { TenantPrincipal } from '@/lib/cloud/types';

// Phase 2X: tenant isolation + lifecycle for persisted recommendations. Gated like the other DB suites.
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function rec(organizationId: string, id: string, over: Partial<Recommendation> = {}): Recommendation {
  const now = Date.now();
  return {
    recommendationId: id, organizationId, accountId: 'act_1',
    entityScope: { entityId: 'meta:act_1:c1', entityLevel: 'campaign', name: 'Campaign 1' },
    category: 'CREATIVE_REVIEW', actionType: 'REVIEW_CREATIVE_REFRESH',
    diagnosis: { type: 'CTR_DETERIORATION', scope: { organizationId, accountId: 'act_1', entityId: 'meta:act_1:c1', entityLevel: 'campaign' }, severity: 'WATCH', summary: { en: 'CTR fell', ar: 'انخفض معدل النقر' }, evidence: [], confidence: 'MEDIUM', dataTrust: 'PLATFORM_REPORTED' },
    reasoning: { en: 'CTR fell 30%', ar: 'انخفض معدل النقر ٣٠٪' },
    evidence: [{ kind: 'ratio', entityIds: ['meta:act_1:c1'], values: { from: 2, to: 1.4 }, dataTrust: 'PLATFORM_REPORTED', calculation: 'CTR delta' }],
    confidence: 'MEDIUM', risk: 'MODERATE', dataTrust: 'PLATFORM_REPORTED', expectedImpact: 'NEGATIVE_RISK_REDUCTION',
    alternatives: [{ actionType: 'NO_ACTION', rationale: { en: 'observe', ar: 'مراقبة' } }],
    requiresHumanApproval: true, status: 'REVIEWABLE',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 3 * 86_400_000).toISOString(),
    ...over,
  };
}

describeDatabase('PostgresRecommendationStore (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const users: string[] = [];
  let a: TenantPrincipal;
  let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`rec-${userId}@example.test`}, '{}'::jsonb)`;
      const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
      const p: TenantPrincipal = { organizationId: m!.organization_id, userId, role: 'owner', scopes: ['tools:read'] };
      if (i === 0) a = p; else b = p;
    }
  });
  afterAll(async () => {
    for (const userId of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${userId})`;
      await admin`delete from auth.users where id = ${userId}`;
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('persists and lists recommendations tenant-scoped (org B never sees org A)', async () => {
    await saveRecommendations(a.organizationId, [rec(a.organizationId, `rec_${randomUUID()}`)]);
    await saveRecommendations(b.organizationId, [rec(b.organizationId, `rec_${randomUUID()}`)]);
    const aList = await listRecommendations(a.organizationId);
    const bList = await listRecommendations(b.organizationId);
    expect(aList.length).toBe(1);
    expect(bList.length).toBe(1);
    expect(aList[0]!.organizationId).toBe(a.organizationId);
    expect(aList.every((r) => r.organizationId === a.organizationId)).toBe(true);
  });

  it('save is idempotent (re-saving the same id does not duplicate)', async () => {
    const id = `rec_${randomUUID()}`;
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id)]);
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id)]);
    expect((await listRecommendations(a.organizationId, { entityId: 'meta:act_1:c1' })).filter((r) => r.recommendationId === id).length).toBe(1);
  });

  it('enforces legal lifecycle transitions and records events; acceptance only changes status', async () => {
    const id = `rec_${randomUUID()}`;
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id, { status: 'REVIEWABLE' })]);
    // REVIEWABLE -> ACCEPTED_FOR_PREVIEW is legal; DRAFT from here is not.
    expect((await transitionRecommendation(a.organizationId, id, 'ACCEPTED_FOR_PREVIEW', { type: 'human_user', id: a.userId! })).ok).toBe(true);
    const after = (await listRecommendations(a.organizationId)).find((r) => r.recommendationId === id)!;
    expect(after.status).toBe('ACCEPTED_FOR_PREVIEW');
    // A second illegal transition is rejected.
    expect((await transitionRecommendation(a.organizationId, id, 'ACCEPTED_FOR_PREVIEW')).ok).toBe(false);
    // Events were recorded (created + accepted_for_preview).
    const counted = await admin<Array<{ count: string }>>`select count(*)::int as count from public.markting_recommendation_events where organization_id = ${a.organizationId} and recommendation_id = ${id}`;
    expect(Number(counted[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);
    // Org B cannot transition org A's recommendation.
    expect((await transitionRecommendation(b.organizationId, id, 'DISMISSED')).ok).toBe(false);
  });

  it('expires past-expiry recommendations (org-scoped)', async () => {
    const id = `rec_${randomUUID()}`;
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id, { status: 'REVIEWABLE', expiresAt: past })]);
    const n = await expireStaleRecommendations(a.organizationId);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await listRecommendations(a.organizationId)).find((r) => r.recommendationId === id)).toBeUndefined(); // EXPIRED excluded by default
  });
});
