import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

/**
 * CODE-RC Program 2 — deterministic E2E tenant seed.
 *
 * Creates the fixed test users + tenants the authenticated browser journeys log into, using the REAL
 * application schemas (auth.users via the Supabase admin API; organizations / memberships / onboarding
 * via SQL). Intelligence CONTENT is served by the DEMO gatherer at render time (the dashboard reads the
 * synthetic seed, not tenant tables, in DEMO runtime), so this seed only needs identities + org
 * membership for `requireDashboardTenant` to resolve. Idempotent: safe to run repeatedly.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL, MARKTING_E2E_TEST_PASSWORD.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const DB = process.env.SUPABASE_DB_URL;
const PASSWORD = process.env.MARKTING_E2E_TEST_PASSWORD;
if (!URL || !SECRET || !DB || !PASSWORD || PASSWORD.length < 12) {
  console.error('e2e seed: missing env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_DB_URL, MARKTING_E2E_TEST_PASSWORD>=12)');
  process.exit(1);
}

const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres(DB, { max: 2 });

const USERS = [
  { email: 'buyer@e2e.test', name: 'E2E Media Buyer' },
  { email: 'agencyadmin@e2e.test', name: 'E2E Agency Admin' },
  { email: 'viewer@e2e.test', name: 'E2E Viewer' },
];

async function ensureUser(email, name) {
  // Idempotent create: if the user already exists, look up its id via the app's helper function.
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } });
  if (created.data?.user) return created.data.user.id;
  const rows = await sql`select private.find_auth_user_id(${email}) as id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create or find user ${email}: ${created.error?.message ?? 'unknown'}`);
  // Reset the password so the known test password always works.
  await admin.auth.admin.updateUserById(id, { password: PASSWORD, email_confirm: true });
  return id;
}

async function ensureOrg(slug, name, createdBy) {
  const rows = await sql`
    insert into public.organizations (name, slug, created_by)
    values (${name}, ${slug}, ${createdBy})
    on conflict (slug) do update set name = excluded.name
    returning id`;
  return rows[0].id;
}

async function ensureMembership(orgId, userId, role) {
  await sql`
    insert into public.organization_memberships (organization_id, user_id, role)
    values (${orgId}, ${userId}, ${role})
    on conflict (organization_id, user_id) do update set role = excluded.role`;
}

async function completeOnboarding(orgId) {
  await sql`
    insert into public.organization_onboarding (organization_id, current_step, selected_agent, completed_at)
    values (${orgId}, 'done', 'media_buyer', now())
    on conflict (organization_id) do update set completed_at = now()`;
}

try {
  const buyer = await ensureUser(USERS[0].email, USERS[0].name);
  const agencyAdmin = await ensureUser(USERS[1].email, USERS[1].name);
  const viewer = await ensureUser(USERS[2].email, USERS[2].name);

  // Org A (buyer's workspace), Org B (separate tenant), Agency (multi-client).
  const orgA = await ensureOrg('e2e-org-a', 'E2E Org A', buyer);
  const orgB = await ensureOrg('e2e-org-b', 'E2E Org B', agencyAdmin);
  const agency = await ensureOrg('e2e-agency', 'E2E Agency', agencyAdmin);

  await ensureMembership(orgA, buyer, 'owner');
  await ensureMembership(orgA, viewer, 'viewer');
  await ensureMembership(orgB, agencyAdmin, 'owner');
  await ensureMembership(agency, agencyAdmin, 'owner');

  for (const org of [orgA, orgB, agency]) await completeOnboarding(org);

  console.log(`e2e seed OK: users(buyer=${buyer.slice(0, 8)}, agencyAdmin=${agencyAdmin.slice(0, 8)}, viewer=${viewer.slice(0, 8)}) orgs(A=${orgA.slice(0, 8)}, B=${orgB.slice(0, 8)}, agency=${agency.slice(0, 8)})`);
} catch (err) {
  console.error('e2e seed FAILED:', err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
