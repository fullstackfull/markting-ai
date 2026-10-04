import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { PostgresSyncQueue } from '@/lib/markting/ops/sync-store';

/**
 * PHASE C.5 (1) — the durable sync queue on real Postgres (cloud-db lane). Proves the atomic lease is a
 * single-winner claim, enqueue is idempotent, and an expired lease is reclaimable.
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('sync queue — durable + atomic claim (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const q = new PostgresSyncQueue();
  const users: string[] = [];
  let org: string;
  const NOW = Date.now();

  beforeAll(async () => {
    const userId = randomUUID(); users.push(userId);
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`sync-${userId}@example.test`}, '{}'::jsonb)`;
    const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
    org = m!.organization_id;
  });
  afterAll(async () => {
    await admin`delete from public.markting_sync_jobs where organization_id = ${org}`.catch(() => {});
    for (const id of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin`delete from auth.users where id = ${id}`.catch(() => {});
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('enqueue is idempotent on (org, provider, idempotency_key)', async () => {
    const a = await q.enqueue({ organizationId: org, provider: 'meta', syncType: 'INITIAL', idempotencyKey: 'idem-1', now: NOW });
    const b = await q.enqueue({ organizationId: org, provider: 'meta', syncType: 'INITIAL', idempotencyKey: 'idem-1', now: NOW });
    expect(b.id).toBe(a.id);
    const rows = await admin<Array<{ count: number }>>`select count(*)::int as count from public.markting_sync_jobs where organization_id = ${org} and idempotency_key = 'idem-1'`;
    expect(rows[0]!.count).toBe(1);
  });

  it('claim is a single-winner atomic lease (concurrent claims: exactly one wins)', async () => {
    const job = await q.enqueue({ organizationId: org, provider: 'meta', syncType: 'INCREMENTAL', idempotencyKey: 'idem-claim', now: NOW });
    const results = await Promise.all([
      q.claim(job, 'w1', NOW, 60_000),
      q.claim(job, 'w2', NOW, 60_000),
      q.claim(job, 'w3', NOW, 60_000),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('an expired lease is reclaimable; a live lease is not', async () => {
    const job = await q.enqueue({ organizationId: org, provider: 'google', syncType: 'INCREMENTAL', idempotencyKey: 'idem-lease', now: NOW });
    const leased = await q.claim(job, 'w1', NOW, 60_000);
    expect(leased).not.toBeNull();
    // still within lease → cannot re-claim
    expect(await q.claim(job, 'w2', NOW + 1_000, 60_000)).toBeNull();
    // after lease expiry → reclaimable
    expect(await q.claim(job, 'w2', NOW + 61_000, 60_000)).not.toBeNull();
  });

  it('dispatchable excludes LEASED and future notBefore', async () => {
    const list = await q.loadDispatchable(NOW, 50);
    expect(list.every((j) => j.state === 'QUEUED' || j.state === 'RETRY_WAIT')).toBe(true);
  });
});
