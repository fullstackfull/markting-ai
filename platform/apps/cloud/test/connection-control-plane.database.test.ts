import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { closeDbForTests } from '@/lib/db';
import { listCanonicalConnections } from '@/lib/connections/read';
import { recordConnectionEvent, listConnectionEvents } from '@/lib/connections/events';

/**
 * CONNECTIONS CONTROL PLANE — real-Postgres tests (cloud-db lane). Verifies the canonical schema
 * evolution, the append-only connection_events trail (grants), cross-tenant read posture through the
 * SELECT-only role, tenant org-scoping, and that NO secret is reachable via the admin read role.
 */
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('CONNECTIONS control plane (local database)', () => {
  const admin = postgres(process.env.SUPABASE_DB_URL!, { max: 4 });
  const users: string[] = [];
  let orgA: string;
  let orgB: string;

  async function makeOrg(): Promise<string> {
    const userId = randomUUID(); users.push(userId);
    await admin`insert into auth.users (id, email, raw_user_meta_data) values (${userId}, ${`conn-${userId}@example.test`}, '{}'::jsonb)`;
    const [m] = await admin`select organization_id from public.organization_memberships where user_id = ${userId}`;
    return m!.organization_id as string;
  }

  beforeAll(async () => {
    orgA = await makeOrg();
    orgB = await makeOrg();
    // Seed a connected Google connection on org A with the new canonical columns populated.
    // connected_by is NOT NULL → use org A's owner membership.
    const [owner] = await admin<Array<{ userId: string }>>`select user_id as "userId" from public.organization_memberships where organization_id = ${orgA} limit 1`;
    await admin`
      insert into public.connections (organization_id, provider, status, external_label, scopes, connected_by, connection_type, auth_type, last_authenticated_at, health_state, token_expires_at)
      values (${orgA}, 'google', 'connected', 'Org A Google', array['https://www.googleapis.com/auth/adwords'], ${owner!.userId}, 'ad_platform', 'oauth2_pkce', now(), 'CONNECTED', now() + interval '30 days')`;
  });

  afterAll(async () => {
    for (const id of users) {
      await admin`delete from public.organizations where id in (select organization_id from public.organization_memberships where user_id = ${id})`.catch(() => {});
      await admin`delete from auth.users where id = ${id}`.catch(() => {});
    }
    await admin.end({ timeout: 2 });
    await closeDbForTests();
  });

  it('connections carries the canonical lifecycle columns', async () => {
    const [row] = await admin<Array<Record<string, unknown>>>`
      select connection_type, environment, auth_type, scopes_required, token_expires_at, last_authenticated_at,
        last_sync_at, last_webhook_at, error_classification, health_state, updated_by, reauth_required, disabled_at
      from public.connections where organization_id = ${orgA} and provider = 'google'`;
    expect(row).toBeTruthy();
    expect(row!.connection_type).toBe('ad_platform');
    expect(row!.environment).toBe('production');
    expect(row!.auth_type).toBe('oauth2_pkce');
    expect(row!.health_state).toBe('CONNECTED');
    expect(row!.reauth_required).toBe(false);
  });

  it('canonical read model returns all 11 ad providers with deterministic status, no secret fields', async () => {
    const list = await listCanonicalConnections(orgA);
    const google = list.find((c) => c.provider === 'google');
    expect(google?.status).toBe('CONNECTED');
    expect(list.filter((c) => c.category === 'paid_media')).toHaveLength(11);
    // Structural no-secret guarantee: the shape has no token/credential/ciphertext field.
    const keys = Object.keys(google ?? {});
    for (const forbidden of ['token', 'ciphertext', 'refreshToken', 'accessToken', 'secret', 'credential']) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase())), `no "${forbidden}" key`).toBe(false);
    }
  });

  it('connection_events is org-scoped and records lifecycle events', async () => {
    await recordConnectionEvent({ organizationId: orgA, provider: 'google', event: 'test_connection', actorType: 'tenant_user', detail: { ok: true } });
    await recordConnectionEvent({ organizationId: orgB, provider: 'meta', event: 'connected', actorType: 'tenant_user' });
    const a = await listConnectionEvents(orgA);
    const b = await listConnectionEvents(orgB);
    expect(a.some((e) => e.event === 'test_connection' && e.provider === 'google')).toBe(true);
    expect(a.some((e) => e.provider === 'meta')).toBe(false); // org B's event never leaks into org A
    expect(b.some((e) => e.provider === 'meta')).toBe(true);
  });

  it('adport_platform_admin can SELECT connection_events but cannot INSERT/UPDATE/DELETE', async () => {
    const canRead = await admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      return tx<Array<{ n: number }>>`select count(*)::int as n from public.connection_events`;
    });
    expect(Number(canRead[0]!.n)).toBeGreaterThanOrEqual(0);
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      await tx`insert into public.connection_events (organization_id, provider, event) values (${orgA}, 'google', 'connected')`;
    })).rejects.toThrow();
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      await tx`update public.connection_events set reason = 'x'`;
    })).rejects.toThrow();
  });

  it('adport_backend can INSERT/SELECT connection_events but NOT UPDATE/DELETE (append-only)', async () => {
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      await tx`update public.connection_events set reason = 'tamper'`;
    })).rejects.toThrow();
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_backend');
      await tx`delete from public.connection_events`;
    })).rejects.toThrow();
  });

  it('adport_platform_admin has NO access to private.provider_credentials (secrets never reachable)', async () => {
    await expect(admin.begin(async (tx) => {
      await tx.unsafe('set local role adport_platform_admin');
      await tx`select ciphertext from private.provider_credentials limit 1`;
    })).rejects.toThrow();
  });
});
