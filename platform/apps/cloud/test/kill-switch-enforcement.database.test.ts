import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { AdportError, type AdProvider, type NormalizedQuery, type WriteGuard, type WriteOperation } from '@adport/core';
import { closeDbForTests } from '@/lib/db';
import { setKillSwitch } from '@/lib/markting/ops/store';
import { KillGuardedProvider } from '@/lib/markting/ops/kill-guarded-provider';
import type { TenantPrincipal } from '@/lib/cloud/types';

/**
 * WAVE 0.1 — prove the kill switch is ENFORCED on the real provider-apply seam (GAP-SEC-01), not just
 * evaluable in the store. The KillGuardedProvider decorator is exactly what createTenantRuntime and
 * createBridgeRuntime wrap every provider in, so blocking here is blocking on the dashboard apply
 * route, REST and MCP alike. Runs against a real Postgres (the cloud-db CI lane).
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

/** A stub provider that records whether its mutation was ever reached. */
class RecordingProvider implements AdProvider {
  readonly id = 'sandbox';
  applied = 0;
  previewed = 0;
  reported = 0;
  capabilities() { return { serverDryRun: false }; }
  async listAccounts() { return []; }
  async report(_query: NormalizedQuery) { this.reported++; return { rows: [], truncated: false }; }
  async previewWrite(_op: WriteOperation, _guard: WriteGuard) { this.previewed++; return { summary: 'ok', changes: [], coercions: [], budgetDeltas: [] } as unknown as Awaited<ReturnType<AdProvider['previewWrite']>>; }
  async applyWrite(_op: WriteOperation, _guard: WriteGuard) { this.applied++; return { status: 'applied', detail: 'ok' } as unknown as Awaited<ReturnType<AdProvider['applyWrite']>>; }
  standardActions() { return {}; }
}

const GUARD = {} as WriteGuard;
const opOn = (accountId: string, kind: WriteOperation['kind'] = 'update'): WriteOperation =>
  ({ tool: 'sandbox_set_budget', provider: 'sandbox', accountId, kind, payload: { toMicros: 12_000 } });

describeDatabase('WAVE 0.1 — kill switch enforced on the provider-apply seam (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let a: TenantPrincipal; let b: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`ks-${userId}@example.test`}, '{}'::jsonb)`;
      const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
      const p: TenantPrincipal = { organizationId: m!.organization_id, userId, role: 'owner', scopes: ['tools:read', 'tools:write'] };
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

  async function clearSwitches() {
    await admin`delete from public.markting_kill_switches`;
  }

  async function expectBlocked(provider: KillGuardedProvider, inner: RecordingProvider, accountId = 'act_1', kind: WriteOperation['kind'] = 'update') {
    const before = inner.applied;
    await expect(provider.applyWrite(opOn(accountId, kind), GUARD)).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    expect(inner.applied, 'inner mutation must NOT be reached when killed (fail closed before mutation)').toBe(before);
  }

  it('each kill scope (GLOBAL/ORGANIZATION/PROVIDER/ACCOUNT/ACTION_TYPE) fails closed at apply time; unaffected scope still works', async () => {
    const inner = new RecordingProvider();
    const provider = new KillGuardedProvider(inner, a.organizationId);

    // Baseline: no switches → apply reaches the provider.
    await clearSwitches();
    await provider.applyWrite(opOn('act_1'), GUARD);
    expect(inner.applied).toBe(1);

    // GLOBAL
    await clearSwitches();
    await setKillSwitch({ scope: 'GLOBAL', key: '', active: true, reason: 'global incident', setBy: a.userId });
    await expectBlocked(provider, inner);

    // ORGANIZATION — blocks target org only
    await clearSwitches();
    await setKillSwitch({ scope: 'ORGANIZATION', key: a.organizationId, organizationId: a.organizationId, active: true, reason: 'org freeze', setBy: a.userId });
    await expectBlocked(provider, inner);
    const otherOrg = new KillGuardedProvider(new RecordingProvider(), b.organizationId);
    await otherOrg.applyWrite(opOn('act_1'), GUARD); // b is unaffected

    // PROVIDER — blocks the named provider
    await clearSwitches();
    await setKillSwitch({ scope: 'PROVIDER', key: 'sandbox', active: true, reason: 'provider outage', setBy: a.userId });
    await expectBlocked(provider, inner);

    // ACCOUNT — org-qualified key; blocks only that account
    await clearSwitches();
    await setKillSwitch({ scope: 'ACCOUNT', key: `${a.organizationId}:act_1`, organizationId: a.organizationId, active: true, reason: 'account lock', setBy: a.userId });
    await expectBlocked(provider, inner, 'act_1');
    const reached = inner.applied;
    await provider.applyWrite(opOn('act_2'), GUARD); // a different account is unaffected
    expect(inner.applied).toBe(reached + 1);

    // ACTION_TYPE — blocks the write kind
    await clearSwitches();
    await setKillSwitch({ scope: 'ACTION_TYPE', key: 'update', active: true, reason: 'freeze updates', setBy: a.userId });
    await expectBlocked(provider, inner, 'act_1', 'update');
    const reached2 = inner.applied;
    await provider.applyWrite(opOn('act_1', 'create'), GUARD); // a different action type is unaffected
    expect(inner.applied).toBe(reached2 + 1);

    await clearSwitches();
  });

  it('reads and previews continue while a write kill switch is active', async () => {
    const inner = new RecordingProvider();
    const provider = new KillGuardedProvider(inner, a.organizationId);
    await clearSwitches();
    await setKillSwitch({ scope: 'ORGANIZATION', key: a.organizationId, organizationId: a.organizationId, active: true, reason: 'freeze', setBy: a.userId });
    await provider.report({ accountIds: ['act_1'], metrics: [], dateRange: { since: '2026-01-01', until: '2026-01-02' } } as unknown as NormalizedQuery);
    await provider.previewWrite(opOn('act_1'), GUARD);
    expect(inner.reported).toBe(1);
    expect(inner.previewed).toBe(1);
    expect(inner.applied).toBe(0);
    await clearSwitches();
  });

  it('no caller can bypass: the guard runs on the one apply seam regardless of actor (AI / service account / stale approval)', async () => {
    // The decorator takes NO actor argument — there is no code path to the inner mutation that skips
    // the kill check. An AI/engine api_client and a service account both reach a provider write ONLY
    // through this same seam, and a previously-granted ("stale") approval is re-evaluated at apply
    // time, so an active switch blocks the mutation no matter who or what triggered it.
    const inner = new RecordingProvider();
    const provider = new KillGuardedProvider(inner, a.organizationId);
    await clearSwitches();
    await setKillSwitch({ scope: 'GLOBAL', key: '', active: true, reason: 'lockdown', setBy: a.userId });
    // Three independent apply attempts standing in for AI, service-account, and stale-approval callers:
    for (let i = 0; i < 3; i++) await expectBlocked(provider, inner);
    expect(inner.applied).toBe(0);
    await clearSwitches();
  });
});
