import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { saveExperiment, listExperiments, saveScenario, getScenario, listScenarios, saveScenarioDecision } from '@/lib/markting/optimize/store';
import type { Experiment } from '@/lib/markting/optimize/experiment-model';
import type { TenantPrincipal } from '@/lib/cloud/types';

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

function experiment(org: string): Experiment {
  return {
    experimentId: 'exp:budget_increase:c1:n1', organizationId: org, type: 'BUDGET_INCREASE', studyType: 'BEFORE_AFTER', assignmentMethod: 'time_split',
    hypothesis: { statement: { en: 'If budget +20% then conversions rise without CPA exceeding target', ar: '...' }, metric: 'conversions', expectedDirection: 'increase', scope: { campaignId: 'c1' }, assumptions: ['targeting constant'], knownRisks: ['CPA may rise'], minimumEvidence: { en: '30 conv/arm', ar: '...' } },
    control: { label: 'control', definition: { en: 'current budget', ar: '...' }, holdConstant: ['targeting'] },
    treatment: { label: 'treatment', definition: { en: '+20% budget', ar: '...' }, change: { en: 'raise budget 20%', ar: '...' } },
    primaryMetric: 'conversions', secondaryMetrics: ['cpa'], guardrailMetrics: ['CPA_CEILING'],
    status: 'DRAFT', observationWindowDays: 14, sampleRequirement: { minConversionsPerArm: 30, minDurationDays: 14 }, confidenceMethod: 'deterministic_sufficiency', contaminationFlags: [],
  };
}

describeDatabase('Phase 6 optimize store (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const users: string[] = [];
  let a: TenantPrincipal; let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`p6-${userId}@example.test`}, '{}'::jsonb)`;
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

  it('experiments are tenant-scoped; cross-tenant write rejected before DB', async () => {
    await saveExperiment(a.organizationId, experiment(a.organizationId));
    expect((await listExperiments(a.organizationId)).length).toBe(1);
    expect((await listExperiments(b.organizationId)).length).toBe(0);
    await expect(saveExperiment(a.organizationId, experiment(b.organizationId))).rejects.toThrow(/organization mismatch/);
  });

  it('widened status set accepts the Phase-6 lifecycle values', async () => {
    const e = { ...experiment(a.organizationId), status: 'READY_FOR_REVIEW' as const };
    await saveExperiment(a.organizationId, e);
    const rows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_experiments where organization_id = ${a.organizationId} and status = 'READY_FOR_REVIEW'`;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  });

  it('optimization scenarios + constraints + decisions persist org-scoped and isolated', async () => {
    await saveScenario(a.organizationId, { scenarioId: 'sc1', mode: 'ALLOCATE_EXTRA', currency: 'SAR', request: { extraMinor: 100000 }, result: { moves: [] }, trace: { engine: 'deterministic_greedy', inputs: {}, constraints: { hard: {}, soft: {} }, calculations: [], assumptions: [], outputs: {}, uncertainty: { en: '', ar: '' }, evidence: [] }, hard: { currency: 'SAR', orgMaxBudgetMinor: 999 }, soft: { conservativeScaling: true } });
    const got = await getScenario(a.organizationId, 'sc1');
    expect(got).toBeTruthy();
    expect(await getScenario(b.organizationId, 'sc1')).toBeNull(); // cross-tenant read isolation
    expect((await listScenarios(a.organizationId)).length).toBe(1);

    await saveScenarioDecision(a.organizationId, { scenarioId: 'sc1', optionKind: 'BALANCED', decision: { note: 'review' }, reviewStatus: 'UNDER_REVIEW' });
    const decRows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_scenario_decisions where organization_id = ${a.organizationId} and scenario_id = 'sc1'`;
    expect(Number(decRows[0]?.count ?? 0)).toBe(1);
    // the decision is a REVIEW record only — review_status, never an execution/provider field.
    const statusRows = await admin<Array<{ reviewStatus: string }>>`select review_status as "reviewStatus" from public.markting_scenario_decisions where organization_id = ${a.organizationId} and scenario_id = 'sc1'`;
    expect(statusRows[0]!.reviewStatus).toBe('UNDER_REVIEW');
  });
});
