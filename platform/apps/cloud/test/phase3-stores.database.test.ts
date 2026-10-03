import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { saveRecommendations } from '@/lib/markting/recommendation-store';
import { writeMemory, listMemory, getMemory, correctMemory, revokeMemory } from '@/lib/markting/memory-store';
import { recordDecisionEvent, traceRecommendation, effectivenessRows, recordTimelineEvent, listTimelineEvents } from '@/lib/markting/decision-store';
import { saveBaseline, recordOutcome, scheduleObservation, claimDueJobs, completeJob, countOutcomes } from '@/lib/markting/outcome-store';
import { loadPlaybook, savePlaybook } from '@/lib/markting/playbook-store';
import { evaluateOutcome } from '@/lib/markting/outcomes';
import type { Recommendation } from '@/lib/markting/intelligence/decision-model';
import type { TenantPrincipal } from '@/lib/cloud/types';

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function rec(org: string, id: string): Recommendation {
  const now = Date.now();
  return { recommendationId: id, organizationId: org, accountId: 'act_1', entityScope: { entityId: 'meta:act_1:c1', entityLevel: 'campaign', name: 'C1' }, category: 'CREATIVE_REVIEW', actionType: 'REVIEW_CREATIVE_REFRESH', diagnosis: { type: 'CTR_DETERIORATION', scope: { organizationId: org, accountId: 'act_1', entityId: 'meta:act_1:c1', entityLevel: 'campaign' }, severity: 'WATCH', summary: { en: 'x', ar: 'x' }, evidence: [], confidence: 'MEDIUM', dataTrust: 'PLATFORM_REPORTED' }, reasoning: { en: 'x', ar: 'x' }, evidence: [], confidence: 'MEDIUM', risk: 'MODERATE', dataTrust: 'PLATFORM_REPORTED', expectedImpact: 'NEGATIVE_RISK_REDUCTION', alternatives: [], requiresHumanApproval: true, status: 'REVIEWABLE', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 3 * 86_400_000).toISOString() };
}

describeDatabase('Phase 3 stores (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const users: string[] = [];
  let a: TenantPrincipal;
  let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`p3-${userId}@example.test`}, '{}'::jsonb)`;
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

  it('memory is tenant-scoped; derived cannot override explicit; revoke works', async () => {
    expect((await writeMemory({ organizationId: a.organizationId, category: 'explicit_fact', key: 'target_roas', value: 3, source: 'human_config', explicit: true })).ok).toBe(true);
    // Org B cannot see org A memory.
    expect((await listMemory(b.organizationId)).length).toBe(0);
    expect((await listMemory(a.organizationId)).length).toBe(1);
    // Derived cannot overwrite the explicit human value.
    expect((await writeMemory({ organizationId: a.organizationId, category: 'explicit_fact', key: 'target_roas', value: 99, source: 'derived_analysis', explicit: false })).ok).toBe(false);
    expect((await getMemory(a.organizationId, 'explicit_fact', 'target_roas'))!.value).toBe(3);
    // Human correction succeeds; revoke invalidates.
    expect((await correctMemory(a.organizationId, 'explicit_fact', 'target_roas', 4, 'human_confirmation')).ok).toBe(true);
    expect((await revokeMemory(a.organizationId, 'explicit_fact', 'target_roas')).ok).toBe(true);
    expect((await listMemory(a.organizationId, { activeOnly: true })).length).toBe(0);
  });

  it('decision events trace rec→preview→apply; acceptance and execution are distinct; org-scoped', async () => {
    const id = `rec_${randomUUID()}`;
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id)]);
    const pendingId = randomUUID();
    await recordDecisionEvent(a.organizationId, { recommendationId: id, stage: 'ACCEPTED', actor: { type: 'human_user', id: a.userId! } });
    await recordDecisionEvent(a.organizationId, { recommendationId: id, stage: 'PREVIEWED', pendingOperationId: pendingId, previewDigest: 'digest-x' });
    await recordDecisionEvent(a.organizationId, { recommendationId: id, stage: 'EXECUTED', pendingOperationId: pendingId, providerResult: { applied: true } });
    const trace = await traceRecommendation(a.organizationId, id);
    expect(trace.currentStage).toBe('EXECUTED');
    expect(trace.pendingOperationId).toBe(pendingId);
    expect(trace.stages.map((s) => s.stage)).toEqual(['ACCEPTED', 'PREVIEWED', 'EXECUTED']);
    // Org B sees no trace for org A's recommendation id.
    expect((await traceRecommendation(b.organizationId, id)).stages.length).toBe(0);
  });

  it('outcomes: baseline → measured; countOutcomes org-scoped', async () => {
    const id = `rec_${randomUUID()}`;
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id)]);
    await saveBaseline(a.organizationId, { recommendationId: id, accountId: 'act_1', entityId: 'meta:act_1:c1', windowLabel: '7d', baseline: { ctr: 2 }, method: 'before/after ctr' });
    const result = evaluateOutcome({ recommendationId: id, category: 'CREATIVE_REVIEW', windowLabel: '7d', before: { entityId: 'meta:act_1:c1', entityLevel: 'campaign', accountId: 'act_1', window: { start: '2026-09-01', end: '2026-09-07' }, currency: 'SAR', attributionBasis: '7d', trust: 'PLATFORM_REPORTED', complete: true, sampleSize: 60, metrics: { ctr: 2 } }, after: { entityId: 'meta:act_1:c1', entityLevel: 'campaign', accountId: 'act_1', window: { start: '2026-09-08', end: '2026-09-14' }, currency: 'SAR', attributionBasis: '7d', trust: 'PLATFORM_REPORTED', complete: true, sampleSize: 60, metrics: { ctr: 3 } } });
    await recordOutcome(a.organizationId, id, '7d', result, { ctr: 3 });
    const counts = await countOutcomes(a.organizationId);
    expect(counts.POSITIVE).toBe(1);
    const bCounts = await countOutcomes(b.organizationId);
    expect(bCounts.POSITIVE).toBe(0);
    // Effectiveness rows reflect the measured outcome.
    await recordDecisionEvent(a.organizationId, { recommendationId: id, stage: 'EXECUTED' });
    const rows = await effectivenessRows(a.organizationId);
    expect(rows.find((r) => r.recommendationId === id)?.outcomeClass).toBe('POSITIVE');
  });

  it('observation jobs are durable, idempotent (dedup), and claimed atomically', async () => {
    const id = `rec_${randomUUID()}`;
    await saveRecommendations(a.organizationId, [rec(a.organizationId, id)]);
    const when = new Date(Date.now() - 1000);
    await scheduleObservation(a.organizationId, id, '7d', when);
    await scheduleObservation(a.organizationId, id, '7d', when); // dedup: no duplicate
    const claimed = await claimDueJobs(new Date(), 100);
    const mine = claimed.filter((j) => j.recommendationId === id);
    expect(mine.length).toBe(1);
    expect(mine[0]!.organizationId).toBe(a.organizationId);
    // A second claim does not re-claim the running job.
    expect((await claimDueJobs(new Date(), 100)).filter((j) => j.recommendationId === id).length).toBe(0);
    await completeJob(mine[0]!.id, 'done');
  });

  it('playbook + timeline are tenant-scoped', async () => {
    await savePlaybook(a.organizationId, { budgetChangePolicy: 'conservative', protectedCampaigns: ['meta:act_1:c1'] });
    expect((await loadPlaybook(a.organizationId)).budgetChangePolicy).toBe('conservative');
    expect((await loadPlaybook(b.organizationId)).budgetChangePolicy).toBeUndefined();
    await recordTimelineEvent(a.organizationId, { eventType: 'tracking_incident', occurredAt: new Date().toISOString(), accountId: 'act_1', source: 'ops', detail: { summary_en: 'pixel outage' } });
    expect((await listTimelineEvents(a.organizationId, 'act_1')).length).toBe(1);
    expect((await listTimelineEvents(b.organizationId, 'act_1')).length).toBe(0);
  });
});
