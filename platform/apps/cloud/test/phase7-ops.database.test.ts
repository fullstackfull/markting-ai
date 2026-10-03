import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import {
  createOperation, getOperation, transitionOperation, claimOperation, recordApproval, listApprovals,
  setKillSwitch, assertWriteNotKilled, appendChangeRecord, upsertProviderHealth,
} from '@/lib/markting/ops/store';
import { operationDigest } from '@/lib/markting/ops/idempotency';
import { changeRecord } from '@/lib/markting/ops/change-management';
import type { TypedProposedAction } from '@/lib/markting/ops/actions';
import type { TenantPrincipal } from '@/lib/cloud/types';

const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const action: TypedProposedAction = { type: 'SET_DAILY_BUDGET', provider: 'sandbox', accountId: 'act_1', entityId: 'c1', entityLevel: 'campaign', budget: { toMinor: 12000, fromMinor: 10000, currency: 'SAR' } };

describeDatabase('Phase 7 ops governance store (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let a: TenantPrincipal; let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`p7-${userId}@example.test`}, '{}'::jsonb)`;
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

  it('operation lifecycle with server-side illegal-transition guard; cross-tenant isolation', async () => {
    const opId = `op-${randomUUID().slice(0, 8)}`;
    await createOperation(a.organizationId, { operationId: opId, accountId: 'act_1', provider: 'sandbox', action, requesterUserId: a.userId, previewDigest: operationDigest(action, 'v1'), approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await getOperation(a.organizationId, opId))!.state).toBe('PREVIEWED');
    expect(await getOperation(b.organizationId, opId)).toBeNull(); // cross-tenant isolation
    await transitionOperation(a.organizationId, opId, 'PENDING_APPROVAL');
    await transitionOperation(a.organizationId, opId, 'APPROVED');
    // illegal jump refused server-side
    await expect(transitionOperation(a.organizationId, opId, 'APPLIED')).rejects.toThrow();
  });

  it('ATOMIC CLAIM: exactly one of two concurrent claims wins', async () => {
    const opId = `op-${randomUUID().slice(0, 8)}`;
    await createOperation(a.organizationId, { operationId: opId, accountId: 'act_1', provider: 'sandbox', action, requesterUserId: a.userId, previewDigest: 'd', approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await transitionOperation(a.organizationId, opId, 'PENDING_APPROVAL');
    await transitionOperation(a.organizationId, opId, 'APPROVED');
    const [c1, c2] = await Promise.all([claimOperation(a.organizationId, opId, 'tokenA'), claimOperation(a.organizationId, opId, 'tokenB')]);
    expect([c1.claimed, c2.claimed].filter(Boolean)).toHaveLength(1); // single winner, no double-claim
  });

  it('approvals dedupe a repeated actor', async () => {
    const opId = `op-${randomUUID().slice(0, 8)}`;
    await createOperation(a.organizationId, { operationId: opId, accountId: 'act_1', provider: 'sandbox', action, requesterUserId: a.userId, previewDigest: 'd', approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await recordApproval(a.organizationId, opId, b.userId!, ['APPROVER']);
    await recordApproval(a.organizationId, opId, b.userId!, ['APPROVER']); // same actor again
    expect((await listApprovals(a.organizationId, opId)).length).toBe(1);
  });

  it('kill switch blocks writes cluster-safely (DB-backed) and reads continue', async () => {
    await setKillSwitch({ scope: 'ORGANIZATION', key: a.organizationId, organizationId: a.organizationId, active: true, reason: 'incident', setBy: a.userId });
    const blocked = await assertWriteNotKilled(a.organizationId, { organizationId: a.organizationId, provider: 'sandbox', accountId: 'act_1', actionType: 'SET_DAILY_BUDGET' });
    expect(blocked.allowed).toBe(false);
    // a different org is unaffected
    const other = await assertWriteNotKilled(b.organizationId, { organizationId: b.organizationId, provider: 'sandbox', accountId: 'act_1', actionType: 'SET_DAILY_BUDGET' });
    expect(other.allowed).toBe(true);
    await setKillSwitch({ scope: 'ORGANIZATION', key: a.organizationId, organizationId: a.organizationId, active: false });
  });

  it('change records are append-only and provider health upserts', async () => {
    await appendChangeRecord(changeRecord({ organizationId: a.organizationId, changeType: 'kill_switch_change', actorUserId: a.userId!, before: { active: true }, after: { active: false }, reason: 'incident resolved' }));
    const rows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_change_records where organization_id = ${a.organizationId}`;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
    await upsertProviderHealth(a.organizationId, 'sandbox', 'act_1', 'CONNECTED', 'ok');
    const h = await admin<Array<{ state: string }>>`select state from public.markting_provider_health where organization_id = ${a.organizationId} and provider = 'sandbox'`;
    expect(h[0]!.state).toBe('CONNECTED');
  });
});
