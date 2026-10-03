import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { PostgresPendingStore } from '@/lib/cloud/repository';
import type { TenantPrincipal } from '@/lib/cloud/types';
import type { ApplyActor, PendingOperation } from '@adport/core';

// R0-01: proves the Postgres compare-and-set claim is atomic across concurrent applies. Gated like
// the other DB suites; CI runs it against a disposable Supabase stack (R0-10).
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const HUMAN_A: ApplyActor = { type: 'human_user', id: 'a' };
const HUMAN_B: ApplyActor = { type: 'human_user', id: 'b' };

function pendingOp(id: string, expiresInMs = 15 * 60_000): PendingOperation {
  return {
    id,
    provider: 'sandbox',
    opHash: 'hash',
    op: { tool: 'sandbox_set_budget', provider: 'sandbox', accountId: 'acc', kind: 'update', payload: { campaign_id: 'c', daily_budget_micros: 1 } },
    preview: { summary: 's', changes: [], coercions: [], budgetDeltas: [], serverValidated: false },
    previewDigest: 'digest',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    state: 'pending',
    requestedBy: { type: 'ai_agent', id: 'engine' },
  };
}

describeDatabase('PostgresPendingStore atomic claim (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  let principal: TenantPrincipal;
  let userId: string;
  let store: PostgresPendingStore;

  beforeAll(async () => {
    userId = randomUUID();
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`claim-${userId}@example.test`}, '{}'::jsonb)`;
    const [membership] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
    principal = { organizationId: membership!.organization_id, userId, role: 'owner', scopes: ['tools:read', 'tools:write'] };
    store = new PostgresPendingStore(principal);
  });
  afterAll(async () => {
    await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${userId})`;
    await admin`delete from auth.users where id = ${userId}`;
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('two concurrent claims of one pending id yield exactly one winner', async () => {
    const id = randomUUID();
    await store.put(pendingOp(id));
    const [a, b] = await Promise.all([store.claim(id, HUMAN_A), store.claim(id, HUMAN_B)]);
    const statuses = [a.status, b.status].sort();
    const winners = [a, b].filter((r) => r.status === 'claimed');
    expect(winners).toHaveLength(1);
    // The loser sees the row already in flight (or terminal), never a second 'claimed'.
    expect(statuses).toContain('claimed');
    expect(statuses.filter((s) => s === 'claimed')).toHaveLength(1);
  });

  it('a claim after apply is an idempotent already_applied (no second claim)', async () => {
    const id = randomUUID();
    await store.put(pendingOp(id));
    const claim = await store.claim(id, HUMAN_A);
    expect(claim.status).toBe('claimed');
    await store.markApplied(id, { applied: true, resourceIds: ['c'] });
    const again = await store.claim(id, HUMAN_B);
    expect(again.status).toBe('already_applied');
    if (again.status === 'already_applied') expect(again.result?.resourceIds).toEqual(['c']);
  });

  it('an expired pending cannot be claimed', async () => {
    const id = randomUUID();
    await store.put(pendingOp(id, -1_000));
    const claim = await store.claim(id, HUMAN_A);
    expect(claim.status).toBe('expired');
  });

  it('a failed row may be re-claimed; a superseded row may not', async () => {
    const id = randomUUID();
    await store.put(pendingOp(id));
    expect((await store.claim(id, HUMAN_A)).status).toBe('claimed');
    await store.markFailed(id, 'provider down');
    expect((await store.claim(id, HUMAN_B)).status).toBe('claimed'); // failed → applying retry
    await store.markSuperseded(id);
    expect((await store.claim(id, HUMAN_A)).status).toBe('superseded');
  });
});
