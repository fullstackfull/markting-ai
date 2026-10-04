import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests, db } from '@/lib/db';
import { getOrganizationEntitlement } from '@/lib/cloud/plans';

/**
 * WAVE 7-26 — platform-admin surfaces: entitlement override resolution (the changed core resolver)
 * and RLS on the new platform tables. Real Postgres (cloud-db lane).
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('WAVE 7-26 — platform admin surfaces (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let org: string;

  beforeAll(async () => {
    const userId = randomUUID(); users.push(userId);
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`surf-${userId}@example.test`}, '{}'::jsonb)`;
    const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
    org = m!.organization_id;
    // Put the org on the premium plan, active.
    await admin`update public.organization_subscriptions set plan = 'premium', status = 'active' where organization_id = ${org}`;
  });
  afterAll(async () => {
    await admin`delete from public.organization_entitlement_overrides where organization_id = ${org}`.catch(() => {});
    for (const id of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin`delete from auth.users where id = ${id}`;
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('plan catalog is seeded identically (5 plans) so base entitlement is unchanged', async () => {
    const seeded = await admin<Array<{ n: number }>>`select count(*)::int as n from public.platform_plans`;
    expect(seeded[0]!.n).toBe(5);
    const ent = await getOrganizationEntitlement(org); // premium, no override
    expect(ent.plan.id).toBe('premium');
    expect(ent.plan.maxActiveAccounts).toBe(15);
    expect(ent.plan.maxMembers).toBe(5);
  });

  it('a per-org override is applied by the single resolver, with the safety ceiling winning', async () => {
    await admin`
      insert into public.organization_entitlement_overrides (organization_id, max_active_accounts, max_retention_days)
      values (${org}, 99, 999999)
      on conflict (organization_id) do update set max_active_accounts = 99, max_retention_days = 999999`;
    const ent = await getOrganizationEntitlement(org);
    expect(ent.plan.maxActiveAccounts, 'override applied').toBe(99);
    expect(ent.plan.maxMembers, 'un-overridden field keeps plan value').toBe(5);
    expect(ent.plan.maxRetentionDays, 'safety ceiling caps retention at 3650').toBe(3650);
  });

  it('adport_platform_admin can SELECT the new platform tables but cannot mutate them', async () => {
    const rows = await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      return tx<Array<{ n: number }>>`select count(*)::int as n from public.platform_plans`;
    });
    expect(rows[0]!.n).toBe(5);
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      await tx.unsafe(`update public.platform_plans set max_members = 0 where id = 'reader'`);
    }), 'SELECT-only role cannot mutate the catalog').rejects.toBeTruthy();
  });

  it('a tenant/browser (authenticated role) cannot read platform surface tables', async () => {
    const blocked = await admin.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      return tx<Array<{ n: number }>>`select count(*)::int as n from public.platform_feature_flags`.catch(() => [{ n: -1 }]);
    });
    expect(blocked[0]!.n, 'authenticated sees no platform flags (RLS/grant deny)').toBeLessThanOrEqual(0);
  });
});
