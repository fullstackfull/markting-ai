import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDbForTests, db } from '@/lib/db';
import { resolveMembership } from '@/lib/cloud/repository';

/**
 * Coherence Program 0 regression test — proves the RLS fixup migration
 * (20261012000000_phase1_rls_fixup.sql) isolates `markting_ai_usage` and
 * `markting_business_context` across tenants, while the server (adport_backend / db()) path keeps
 * working. Real Postgres only (ADPORT_RUN_DATABASE_TESTS=1), mirroring database.integration.test.ts.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const describeDatabase = process.env.ADPORT_RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describeDatabase('Phase-1 RLS fixup — ai_usage + business_context tenant isolation', () => {
  const password = 'Local-Test-Passw0rd!';
  const users: string[] = [];
  let orgA: string;
  let orgB: string;
  let userA: string;
  let clientA: SupabaseClient;

  beforeAll(async () => {
    for (const label of ['a', 'b']) {
      const email = `rls-${label}-${randomUUID()}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error('user creation failed');
      users.push(data.user.id);
      const signInClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await signInClient.auth.signInWithPassword({ email, password });
      if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('sign in failed');
      const membership = await resolveMembership(data.user.id);
      if (label === 'a') {
        userA = data.user.id;
        orgA = membership.organizationId;
        clientA = createClient(url, publishableKey, {
          global: { headers: { Authorization: `Bearer ${signedIn.data.session.access_token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
      } else {
        orgB = membership.organizationId;
      }
    }
    // Seed one row per table for BOTH orgs via the service path (db() bypasses RLS as owner).
    for (const org of [orgA, orgB]) {
      await db()`
        insert into public.markting_ai_usage
          (organization_id, request_id, feature, model, provider, status, estimated_cost_micros)
        values (${org}, ${'req-' + org}, 'assistant', 'scripted-demo', 'scripted', 'ok', 1234)
      `;
      await db()`
        insert into public.markting_business_context (organization_id, configured)
        values (${org}, ${db().json({ vertical: 'ecommerce', secret: org })})
        on conflict (organization_id) do update set configured = excluded.configured
      `;
    }
  });

  afterAll(async () => {
    // adport_backend is not granted DELETE on these append/upsert tables; deleting the organization
    // removes the child rows via the `on delete cascade` FK (same pattern as the isolation harness).
    await db()`delete from public.organizations where id in ${db()([orgA, orgB])}`;
    for (const id of users) await admin.auth.admin.deleteUser(id);
    await closeDbForTests();
  });

  it('org A cannot READ org B ai_usage (and cannot read its own via the browser role)', async () => {
    const other = await clientA.from('markting_ai_usage').select('*').eq('organization_id', orgB);
    expect(other.data ?? []).toEqual([]); // permission denied or RLS-filtered — never org B's row
    const own = await clientA.from('markting_ai_usage').select('*').eq('organization_id', orgA);
    expect(own.data ?? []).toEqual([]); // browser role has no access at all; server path is the only reader
  });

  it('org A cannot WRITE ai_usage for any org', async () => {
    const write = await clientA.from('markting_ai_usage').insert({
      organization_id: orgB, request_id: 'evil', feature: 'assistant', model: 'x', provider: 'x', status: 'ok',
    });
    expect(write.error).not.toBeNull();
  });

  it('org A cannot READ org B business_context', async () => {
    const other = await clientA.from('markting_business_context').select('*').eq('organization_id', orgB);
    expect(other.data ?? []).toEqual([]);
  });

  it('org A cannot MUTATE org B business_context', async () => {
    const write = await clientA
      .from('markting_business_context')
      .update({ configured: { hijacked: true } })
      .eq('organization_id', orgB);
    expect(write.error).not.toBeNull();
    // Prove the row is untouched via the server path.
    const rows = await db()<Array<{ configured: { secret?: string } }>>`
      select configured from public.markting_business_context where organization_id = ${orgB}
    `;
    expect(rows[0]?.configured?.secret).toBe(orgB);
  });

  it('the server (db / adport_backend) path still reads both tables for both orgs', async () => {
    // db() applies postgres.camel.column, so organization_id comes back as organizationId.
    const usage = await db()<Array<{ organizationId: string }>>`
      select organization_id from public.markting_ai_usage where organization_id in ${db()([orgA, orgB])}
    `;
    expect(new Set(usage.map((r) => r.organizationId))).toEqual(new Set([orgA, orgB]));
    const ctx = await db()<Array<{ organizationId: string }>>`
      select organization_id from public.markting_business_context where organization_id in ${db()([orgA, orgB])}
    `;
    expect(new Set(ctx.map((r) => r.organizationId))).toEqual(new Set([orgA, orgB]));
  });
});
