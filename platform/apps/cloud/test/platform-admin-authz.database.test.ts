import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests, db } from '@/lib/db';

/**
 * WAVE 1 / WAVE 26 — platform authorization & isolation on real Postgres.
 *
 * Proves: a tenant user (authenticated / PostgREST browser path) cannot read platform-admin data;
 * the dedicated adport_platform_admin role can SELECT cross-tenant but CANNOT mutate tenant data;
 * and platform_admin_audit is append-only (no UPDATE/DELETE even for the backend role).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('WAVE 1 — platform identity authorization & isolation (local database)', () => {
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let operatorId: string;
  let tenantClient: SupabaseClient;

  beforeAll(async () => {
    // An operator user (seeded into the platform roster) and a plain tenant user (never an operator).
    const op = await admin.auth.admin.createUser({ email: `op-${randomUUID()}@example.test`, email_confirm: true });
    operatorId = op.data.user!.id; users.push(operatorId);
    await db()`insert into public.platform_operators (user_id, role, created_by) values (${operatorId}, 'SUPER_ADMIN', ${operatorId})`;

    const password = 'Local-Test-Passw0rd!';
    const tenant = await admin.auth.admin.createUser({ email: `tenant-${randomUUID()}@example.test`, password, email_confirm: true });
    users.push(tenant.data.user!.id);
    const signIn = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await signIn.auth.signInWithPassword({ email: tenant.data.user!.email!, password });
    tenantClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${signed.data.session!.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    await db()`delete from public.platform_admin_audit where actor_user_id = ${operatorId}`.catch(() => {});
    for (const id of users) {
      await db()`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin.auth.admin.deleteUser(id);
    }
    await sql.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('a tenant user (authenticated/browser path) cannot read the platform roster or platform audit', async () => {
    const roster = await tenantClient.from('platform_operators').select('*');
    expect((roster.data ?? []).length, 'tenant user must not see any platform_operators rows').toBe(0);
    const audit = await tenantClient.from('platform_admin_audit').select('*');
    expect((audit.data ?? []).length, 'tenant user must not see any platform_admin_audit rows').toBe(0);
  });

  it('a tenant owner is NOT a platform operator (no roster row ⇒ no authority)', async () => {
    const tenantUserId = users[1]!;
    const rows = await db()<Array<{ role: string }>>`select role from public.platform_operators where user_id = ${tenantUserId} and status = 'active'`;
    expect(rows.length).toBe(0);
  });

  it('adport_platform_admin can SELECT cross-tenant but cannot mutate tenant data', async () => {
    const readCount = await sql.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      return tx<Array<{ n: number }>>`select count(*)::int as n from public.organizations`;
    });
    expect(readCount[0]!.n).toBeGreaterThanOrEqual(1); // it can read across tenants

    const slug = `x-${randomUUID()}`;
    await expect(sql.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      await tx.unsafe(`insert into public.organizations (name, slug, created_by) values ('x', '${slug}', '${operatorId}')`);
    }), 'SELECT-only role must be denied INSERT on tenant tables').rejects.toBeTruthy();
  });

  it('platform_admin_audit is append-only: backend may INSERT/SELECT but not UPDATE/DELETE', async () => {
    await db()`insert into public.platform_admin_audit (actor_user_id, platform_role, action, reason) values (${operatorId}, 'SUPER_ADMIN', 'test.action', 'wave1 test')`;
    const rows = await db()<Array<{ id: string }>>`select id from public.platform_admin_audit where actor_user_id = ${operatorId} limit 1`;
    expect(rows.length).toBe(1);
    await expect(db()`update public.platform_admin_audit set action = 'tamper' where id = ${rows[0]!.id}`, 'audit must not be UPDATE-able').rejects.toBeTruthy();
    await expect(db()`delete from public.platform_admin_audit where id = ${rows[0]!.id}`, 'audit must not be DELETE-able').rejects.toBeTruthy();
  });
});
