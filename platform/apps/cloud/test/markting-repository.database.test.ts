import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import {
  claimThread, findEngineProposal, loadAliasMap, markPendingOutcome, PostgresSandboxStore, provenanceForPending,
  recordEngineProposal, resetSandboxState, threadIdFor, upsertAlias,
} from '@/lib/markting/repository';
import { sandboxSeed } from '@/lib/markting/sandbox-provider';
import type { TenantPrincipal } from '@/lib/cloud/types';

// Gated like the upstream database suites: runs only against the local Supabase stack.
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('markting bridge tables (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 1 });
  const users: string[] = [];
  let principal: TenantPrincipal;
  let other: TenantPrincipal;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID(); users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`markting-${userId}@example.test`}, '{}'::jsonb)`;
      const [membership] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
      const value: TenantPrincipal = { organizationId: membership!.organization_id, userId, role: 'owner', scopes: ['tools:read', 'tools:write'] };
      if (i === 0) principal = value; else other = value;
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

  it('threads belong to the user who created them', async () => {
    const threadId = threadIdFor(principal.organizationId, principal.userId!, 'abc123');
    expect(await claimThread(principal, threadId, 'first question')).toBe(true);
    expect(await claimThread(principal, threadId)).toBe(true);
    expect(await claimThread(other, threadId)).toBe(false);
  });

  it('alias map merges demo defaults with per-organization rows and stays tenant-scoped', async () => {
    await upsertAlias(principal.organizationId, { alias: 'acme-google', provider: 'google', accountId: '1234567890', currency: 'USD', targets: { 'g-1': '42' } });
    const demo = await loadAliasMap(principal.organizationId, true);
    expect(demo['demo-google']).toMatchObject({ provider: 'sandbox', accountId: 'fixture-google-0001' });
    expect(demo['acme-google']).toMatchObject({ provider: 'google', accountId: '1234567890', targets: { 'g-1': '42' } });
    const live = await loadAliasMap(principal.organizationId, false);
    expect(live['demo-google']).toBeUndefined();
    expect((await loadAliasMap(other.organizationId, false))['acme-google']).toBeUndefined();
  });

  it('records provenance, links it to a pending operation and updates the outcome', async () => {
    const pendingId = randomUUID();
    await admin`
      insert into public.pending_operations (id, organization_id, provider, operation_hash, operation, preview, created_at, expires_at)
      values (${pendingId}, ${principal.organizationId}, 'sandbox', 'hash', '{"tool":"sandbox_set_budget"}'::jsonb, '{"summary":"x"}'::jsonb, now(), now() + interval '15 minutes')
    `;
    const proposalId = randomUUID();
    const base = {
      proposalId, revision: 1, threadId: null, platform: 'google_ads', accountRef: 'demo-google', toolName: 'google_ads__update_campaign_budget', targetRef: 'g-103',
      payloadDigest: 'digest', proposal: { proposal_id: proposalId, reason: 'test' }, translation: { status: 'ok' as const, provider: 'sandbox' as const, accountId: 'fixture-google-0001', tool: 'sandbox_set_budget', kind: 'update' as const, input: {}, notes: [] },
    };
    await recordEngineProposal(principal, { ...base, pendingOperationId: pendingId, status: 'pending' });
    const found = await findEngineProposal(principal.organizationId, proposalId, 1);
    expect(found).toMatchObject({ status: 'pending', pendingOperationId: pendingId, engineToolName: 'google_ads__update_campaign_budget' });
    const map = await provenanceForPending(principal.organizationId, [pendingId, randomUUID()]);
    expect(map.get(pendingId)?.proposalId).toBe(proposalId);
    expect((await provenanceForPending(other.organizationId, [pendingId])).size).toBe(0);
    await markPendingOutcome(principal.organizationId, pendingId, 'applied');
    expect((await findEngineProposal(principal.organizationId, proposalId, 1))?.status).toBe('applied');
    // Same (proposal, revision) is idempotent: re-recording updates instead of duplicating.
    await recordEngineProposal(principal, { ...base, pendingOperationId: null, status: 'unsupported', detail: 'again' });
    expect((await findEngineProposal(principal.organizationId, proposalId, 1))?.detail).toBe('again');
  });

  it('sandbox state seeds lazily and enforces compare-and-set per organization', async () => {
    await resetSandboxState(principal.organizationId);
    const store = new PostgresSandboxStore(principal.organizationId);
    const loaded = await store.load();
    expect(loaded).toEqual(sandboxSeed());
    const next = loaded.map((c) => (c.id === 'g-103' ? { ...c, dailyBudgetMicros: 240_000_000 } : c));
    await store.save(loaded, next);
    expect((await store.load()).find((c) => c.id === 'g-103')?.dailyBudgetMicros).toBe(240_000_000);
    await expect(store.save(loaded, next)).rejects.toMatchObject({ code: 'PENDING_MISMATCH' });
    expect((await new PostgresSandboxStore(other.organizationId).load()).find((c) => c.id === 'g-103')?.dailyBudgetMicros).toBe(300_000_000);
  });
});
