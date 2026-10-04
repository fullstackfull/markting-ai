import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * PHASE B (B17/B18) — tenant-isolation RLS backstop. Real Postgres only (cloud-db lane,
 * ADPORT_RUN_DATABASE_TESTS=1). Proves the restrictive policies from migration
 * 20261018000000_tenant_rls_backstop.sql clamp `adport_backend` to a single org WHEN the
 * transaction-local GUC `app.current_organization_id` is set, while leaving the GUC-unset
 * service-job path (cross-tenant reads) and the `adport_platform_admin` read role untouched.
 *
 * Representative tenant table: `public.findings` — it carries organization_id and the backend holds
 * full SELECT/INSERT/UPDATE/DELETE on it, so every command path can be exercised. Seeding is done via
 * the owner connection (SUPABASE_DB_URL), which is the table owner and bypasses RLS; the backstop is
 * then asserted under `set local role adport_backend`. Orgs are created through the auth.users →
 * handle_new_user trigger (same pattern as audit-append-only.database.test.ts).
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('tenant RLS backstop — adport_backend org clamp (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let orgA: string;
  let orgB: string;

  const seedFinding = (org: string, id: string) => admin`
    insert into public.findings (organization_id, id, provider, status, severity, finding)
    values (${org}, ${id}, 'meta', 'open', 'info', ${admin.json({ seed: org })})
  `;

  beforeAll(async () => {
    for (const label of ['a', 'b'] as const) {
      const userId = randomUUID();
      users.push(userId);
      await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`rls-${label}-${userId}@example.test`}, '{}'::jsonb)`;
      const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
      if (label === 'a') orgA = m!.organization_id;
      else orgB = m!.organization_id;
    }
    // Seed one finding per org via the owner path (bypasses RLS).
    await seedFinding(orgA, 'f-a');
    await seedFinding(orgB, 'f-b');
  });

  afterAll(async () => {
    for (const id of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin`delete from auth.users where id = ${id}`.catch(() => {});
    }
    await admin.end({ timeout: 2 });
  });

  // Helper: run `fn` as adport_backend with the org GUC set (mirrors lib/db.ts withTenant).
  const asBackendForOrg = <T>(org: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      await tx`select set_config('app.current_organization_id', ${org}, true)`;
      return fn(tx);
    }) as Promise<T>;

  it('org A (GUC set) can read its OWN rows but NOT org B rows', async () => {
    const result = await asBackendForOrg(orgA, async (tx) => {
      const own = await tx<Array<{ id: string }>>`select id from public.findings where organization_id = ${orgA}`;
      const other = await tx<Array<{ id: string }>>`select id from public.findings where organization_id = ${orgB}`;
      // Even without a WHERE clause the backstop must hide org B.
      const unscoped = await tx<Array<{ organization_id: string }>>`select organization_id from public.findings`;
      return { own, other, unscoped };
    });
    expect(result.own.map((r) => r.id)).toContain('f-a');
    expect(result.other).toEqual([]);
    expect(new Set(result.unscoped.map((r) => r.organization_id))).toEqual(new Set([orgA]));
  });

  it('org A (GUC set) canNOT INSERT a row for org B (with check fails)', async () => {
    await expect(
      asBackendForOrg(orgA, (tx) => tx`
        insert into public.findings (organization_id, id, provider, status, severity, finding)
        values (${orgB}, ${'evil-insert'}, 'meta', 'open', 'info', ${admin.json({ evil: true })})
      `),
    ).rejects.toThrow();
    // Confirm nothing landed (owner view).
    const rows = await admin`select 1 from public.findings where organization_id = ${orgB} and id = 'evil-insert'`;
    expect(rows.length).toBe(0);
  });

  it('org A (GUC set) canNOT UPDATE org B rows (filtered, 0 affected, row untouched)', async () => {
    const affected = await asBackendForOrg(orgA, async (tx) => {
      const r = await tx`update public.findings set status = 'dismissed' where organization_id = ${orgB}`;
      return r.count;
    });
    expect(affected).toBe(0);
    const [row] = await admin<Array<{ status: string }>>`select status from public.findings where organization_id = ${orgB} and id = 'f-b'`;
    expect(row!.status).toBe('open'); // untouched
  });

  it('org A (GUC set) canNOT DELETE org B rows (filtered, 0 affected, row survives)', async () => {
    const affected = await asBackendForOrg(orgA, async (tx) => {
      const r = await tx`delete from public.findings where organization_id = ${orgB}`;
      return r.count;
    });
    expect(affected).toBe(0);
    const survivors = await admin`select 1 from public.findings where organization_id = ${orgB} and id = 'f-b'`;
    expect(survivors.length).toBe(1);
  });

  it('with the GUC UNSET, adport_backend still reads ACROSS orgs (service-job path unbroken)', async () => {
    const rows = await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      // No set_config here: the restrictive policy is a no-op when the GUC is unset.
      return tx<Array<{ organization_id: string }>>`select organization_id from public.findings where organization_id in ${tx([orgA, orgB])}`;
    });
    expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set([orgA, orgB]));
  });

  it('adport_platform_admin SELECT role is unaffected (still reads cross-tenant, read-only)', async () => {
    const rows = await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      return tx<Array<{ organization_id: string }>>`select organization_id from public.findings where organization_id in ${tx([orgA, orgB])}`;
    });
    expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set([orgA, orgB]));
    // The admin read role has no write grant — a write must fail regardless of the backstop.
    await expect(
      admin.begin(async (tx) => {
        await tx.unsafe('set local role adport_platform_admin');
        await tx`update public.findings set status = 'dismissed' where organization_id = ${orgA}`;
      }),
    ).rejects.toThrow();
  });
});
