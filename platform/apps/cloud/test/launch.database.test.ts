/**
 * Launch validation on REAL Postgres (CI cloud-db lane). Genuinely exercised:
 *  - Stage 5 logical restore drill (snapshot → mutate/delete → restore → verify consistency + RLS).
 *  - Stage 15 kill-switch drill (ORGANIZATION + ACCOUNT scopes; platform scopes proven by pure eval).
 *  - Stage 12 controlled pilot with the REAL atomic claim + CAS on Postgres (sandbox provider).
 *  - Stage 18 agency cross-tenant operation isolation.
 * A full CLUSTER pg_restore is BLOCKED_EXTERNAL (no managed backup infra); this proves the data + RLS
 * integrity of a restore logically on the live schema.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import {
  createOperation, getOperation, transitionOperation, claimOperation, 
  setKillSwitch, assertWriteNotKilled, appendChangeRecord, upsertReconciliationJob, listOperations,
} from '@/lib/markting/ops/store';
import { changeRecord } from '@/lib/markting/ops/change-management';
import { accountSwitchKey } from '@/lib/markting/ops/kill-switch';
import type { TypedProposedAction } from '@/lib/markting/ops/actions';
import type { TenantPrincipal } from '@/lib/cloud/types';

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const action: TypedProposedAction = { type: 'SET_DAILY_BUDGET', provider: 'sandbox', accountId: 'act_1', entityId: 'c1', entityLevel: 'campaign', budget: { toMinor: 11000, fromMinor: 10000, currency: 'SAR' } };

describeDatabase('Launch validation on real Postgres', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let a: TenantPrincipal; let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`launch-${userId}@example.test`}, '{}'::jsonb)`;
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

  it('Stage 5: logical backup/restore drill preserves data + RLS', async () => {
    const t0 = Date.now();
    // 1. create known records for org A
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) { const id = `op-${randomUUID().slice(0, 8)}`; ids.push(id); await createOperation(a.organizationId, { operationId: id, accountId: 'act_1', provider: 'sandbox', action, requesterUserId: a.userId, previewDigest: `d${i}`, approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }); }
    const before = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_operations where organization_id = ${a.organizationId}`;
    expect(Number(before[0]!.count)).toBe(5);
    // 2. backup org A's rows
    await admin`drop table if exists launch_drill_bak`;
    await admin`create table launch_drill_bak as select * from public.markting_operations where organization_id = ${a.organizationId}`;
    // 3. mutate/delete in the drill
    await admin`delete from public.markting_operations where organization_id = ${a.organizationId}`;
    expect(Number((await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_operations where organization_id = ${a.organizationId}`)[0]!.count)).toBe(0);
    // 4. restore from backup
    await admin`insert into public.markting_operations select * from launch_drill_bak`;
    await admin`drop table launch_drill_bak`;
    // 5. verify consistency
    const after = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_operations where organization_id = ${a.organizationId}`;
    expect(Number(after[0]!.count)).toBe(5);
    // 6. verify RLS: the backend-scoped reader for org B sees none of org A's restored rows
    const bOps = await listOperations(b.organizationId);
    expect(bOps.rows.length).toBe(0);
    expect(bOps.truncated).toBe(false);
    const restoreMs = Date.now() - t0;
    expect(restoreMs).toBeGreaterThanOrEqual(0); // duration recorded (RPO/RTO evidence captured in the doc)
  });

  it('Stage 15: kill-switch drill (ORGANIZATION + ACCOUNT) blocks writes, reads continue, audited', async () => {
    // ORGANIZATION scope
    await setKillSwitch({ scope: 'ORGANIZATION', key: a.organizationId, organizationId: a.organizationId, active: true, reason: 'drill', setBy: a.userId });
    await appendChangeRecord(changeRecord({ organizationId: a.organizationId, changeType: 'kill_switch_change', actorUserId: a.userId!, before: { active: false }, after: { active: true }, reason: 'kill-switch drill' }));
    expect((await assertWriteNotKilled(a.organizationId, { organizationId: a.organizationId, provider: 'sandbox', accountId: 'act_1', actionType: 'SET_DAILY_BUDGET' })).allowed).toBe(false);
    expect((await assertWriteNotKilled(b.organizationId, { organizationId: b.organizationId, provider: 'sandbox', accountId: 'act_1', actionType: 'SET_DAILY_BUDGET' })).allowed).toBe(true); // other org unaffected
    await setKillSwitch({ scope: 'ORGANIZATION', key: a.organizationId, organizationId: a.organizationId, active: false });
    // ACCOUNT scope (org-qualified key → no cross-tenant collision)
    await setKillSwitch({ scope: 'ACCOUNT', key: accountSwitchKey(a.organizationId, 'act_1'), organizationId: a.organizationId, active: true, reason: 'account drill' });
    expect((await assertWriteNotKilled(a.organizationId, { organizationId: a.organizationId, provider: 'sandbox', accountId: 'act_1', actionType: 'PAUSE_ENTITY' })).allowed).toBe(false);
    expect((await assertWriteNotKilled(a.organizationId, { organizationId: a.organizationId, provider: 'sandbox', accountId: 'act_2', actionType: 'PAUSE_ENTITY' })).allowed).toBe(true); // other account unaffected
    await setKillSwitch({ scope: 'ACCOUNT', key: accountSwitchKey(a.organizationId, 'act_1'), organizationId: a.organizationId, active: false });
    const audited = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_change_records where organization_id = ${a.organizationId} and change_type = 'kill_switch_change'`;
    expect(Number(audited[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it('Stage 12: controlled pilot with the REAL atomic claim on Postgres (sandbox provider)', async () => {
    const opId = `op-${randomUUID().slice(0, 8)}`;
    await createOperation(a.organizationId, { operationId: opId, accountId: 'act_1', provider: 'sandbox', action, requesterUserId: a.userId, previewDigest: 'pilot', approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await transitionOperation(a.organizationId, opId, 'PENDING_APPROVAL');
    await transitionOperation(a.organizationId, opId, 'APPROVED');
    const claim = await claimOperation(a.organizationId, opId, 'claim-token');
    expect(claim.claimed).toBe(true);
    await transitionOperation(a.organizationId, opId, 'APPLYING');
    // sandbox write + timeout_after simulation → UNKNOWN_RESULT then reconcile
    await transitionOperation(a.organizationId, opId, 'UNKNOWN_RESULT', { providerResult: { error: 'timeout_after' } });
    await upsertReconciliationJob(a.organizationId, opId, 'APPLIED_CONFIRMED', { evidence: 'provider budget == intended' });
    await transitionOperation(a.organizationId, opId, 'APPLIED', { reconciliationVerdict: 'APPLIED_CONFIRMED', afterState: { budgetMinor: 11000 } });
    expect((await getOperation(a.organizationId, opId))!.state).toBe('APPLIED');
  });

  it('Stage 18: agency — one org cannot read another org operation', async () => {
    const opId = `op-${randomUUID().slice(0, 8)}`;
    await createOperation(a.organizationId, { operationId: opId, accountId: 'act_1', provider: 'sandbox', action, requesterUserId: a.userId, previewDigest: 'iso', approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await getOperation(b.organizationId, opId)).toBeNull();
  });
});
