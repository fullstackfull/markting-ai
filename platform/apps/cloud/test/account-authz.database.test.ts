import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { tenantOwnsAccount, authorizeTenantAccount } from '@/lib/cloud/account-authz';

/**
 * PHASE C0.1 — the canonical tenant↔account authorization guard, LIVE branch, against real Postgres
 * (cloud-db lane, ADPORT_RUN_DATABASE_TESTS=1). Proves the cross-tenant security boundary the whole
 * account/campaign/group/ad/creative/breakdown drill-down rests on: an organization can authorize ONLY
 * the ad accounts discovered under its own connections (public.organization_ad_accounts), and every
 * attempt to reach another tenant's account — or to guess an id that exists in no tenant — is denied
 * identically (notFound), with no existence oracle.
 *
 * Because campaigns/groups/ads/creatives/breakdowns are always nested WITHIN an account, blocking the
 * account at this boundary blocks every cross-tenant drill URL built on it; the remaining nested
 * parent-chain integrity (a group under the wrong campaign, an ad under the wrong group) is enforced by
 * the section builders and covered by test/seed-hierarchy.test.ts.
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('account authz guard — live cross-tenant boundary (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 2 });
  const users: string[] = [];
  let orgA: string;
  let orgB: string;
  const ACCOUNT_A = 'meta:act:aaaa-1111';
  const ACCOUNT_B = 'meta:act:bbbb-2222';
  let prevMode: string | undefined;

  const seedAccount = async (org: string, userId: string, accountId: string) => {
    const [conn] = await admin<Array<{ id: string }>>`
      insert into public.connections (organization_id, provider, status, connected_by)
      values (${org}, 'meta', 'connected', ${userId})
      returning id
    `;
    await admin`
      insert into public.organization_ad_accounts
        (organization_id, connection_id, provider, account_id, name, enabled)
      values (${org}, ${conn!.id}, 'meta', ${accountId}, ${`Account ${accountId}`}, true)
    `;
  };

  beforeAll(async () => {
    // Force the LIVE branch of the guard (DB-backed ownership), not the DEMO seed branch.
    prevMode = process.env.MARKTING_RUNTIME_MODE;
    process.env.MARKTING_RUNTIME_MODE = 'LIVE_WRITE_DISABLED';
    for (const label of ['a', 'b'] as const) {
      const userId = randomUUID();
      users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`authz-${label}-${userId}@example.test`}, '{}'::jsonb)`;
      const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
      if (label === 'a') { orgA = m!.organization_id; await seedAccount(orgA, userId, ACCOUNT_A); }
      else { orgB = m!.organization_id; await seedAccount(orgB, userId, ACCOUNT_B); }
    }
  });

  afterAll(async () => {
    if (prevMode === undefined) delete process.env.MARKTING_RUNTIME_MODE;
    else process.env.MARKTING_RUNTIME_MODE = prevMode;
    for (const userId of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${userId})`.catch(() => {});
      await admin`delete from auth.users where id = ${userId}`.catch(() => {});
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('an org owns its OWN discovered account', async () => {
    expect(await tenantOwnsAccount({ organizationId: orgA }, ACCOUNT_A)).toBe(true);
    expect(await tenantOwnsAccount({ organizationId: orgB }, ACCOUNT_B)).toBe(true);
  });

  it('an org canNOT own another tenant\'s account (cross-tenant URL guess)', async () => {
    expect(await tenantOwnsAccount({ organizationId: orgA }, ACCOUNT_B)).toBe(false);
    expect(await tenantOwnsAccount({ organizationId: orgB }, ACCOUNT_A)).toBe(false);
  });

  it('an account id that exists in NO tenant is denied (no existence oracle)', async () => {
    expect(await tenantOwnsAccount({ organizationId: orgA }, 'meta:act:does-not-exist')).toBe(false);
    // A cross-tenant real id and a never-seen id are indistinguishable at the guard: both false.
    expect(await tenantOwnsAccount({ organizationId: orgA }, ACCOUNT_B))
      .toBe(await tenantOwnsAccount({ organizationId: orgA }, 'meta:act:does-not-exist'));
  });

  it('empty / missing account id is denied', async () => {
    expect(await tenantOwnsAccount({ organizationId: orgA }, undefined)).toBe(false);
    expect(await tenantOwnsAccount({ organizationId: orgA }, null)).toBe(false);
    expect(await tenantOwnsAccount({ organizationId: orgA }, '')).toBe(false);
  });

  it('authorizeTenantAccount throws notFound() for a cross-tenant account, passes for an owned one', async () => {
    // Next notFound() throws an error carrying the 404 fallback digest.
    await expect(authorizeTenantAccount({ organizationId: orgA }, ACCOUNT_B)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK'),
    });
    await expect(authorizeTenantAccount({ organizationId: orgA }, ACCOUNT_A)).resolves.toBeUndefined();
  });
});
