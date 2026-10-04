import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * PHASE A (A3) — tenant audit_events is append-only at the DB layer. Real Postgres (cloud-db lane).
 * Proves the REVOKE (migration 20261017000000) holds: adport_backend may INSERT + SELECT but NOT
 * UPDATE or DELETE audit_events — enforcement, not convention.
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('audit_events append-only (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let org: string;

  beforeAll(async () => {
    const userId = randomUUID(); users.push(userId);
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`audit-${userId}@example.test`}, '{}'::jsonb)`;
    const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
    org = m!.organization_id;
  });
  afterAll(async () => {
    for (const id of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin`delete from auth.users where id = ${id}`.catch(() => {});
    }
    await admin.end({ timeout: 2 });
  });

  it('adport_backend can INSERT a tenant audit event', async () => {
    await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      await tx`insert into public.audit_events (organization_id, event, provider, tool, account_id, summary) values (${org}, 'connected', 'meta', 'connect', 'act_1', 'appended')`;
    });
    const rows = await admin<Array<{ n: number }>>`select count(*)::int as n from public.audit_events where organization_id = ${org}`;
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('adport_backend can SELECT audit events', async () => {
    const rows = await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      return tx<Array<{ n: number }>>`select count(*)::int as n from public.audit_events where organization_id = ${org}`;
    });
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it('adport_backend CANNOT UPDATE an audit event (append-only)', async () => {
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      await tx`update public.audit_events set summary = 'tamper' where organization_id = ${org}`;
    })).rejects.toThrow();
  });

  it('adport_backend CANNOT DELETE an audit event (append-only)', async () => {
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      await tx`delete from public.audit_events where organization_id = ${org}`;
    })).rejects.toThrow();
  });
});
