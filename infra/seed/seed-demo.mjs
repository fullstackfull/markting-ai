#!/usr/bin/env node
// Seed the demo workspace against the running local stack:
//   1. create the demo user through Supabase Auth (so adport's handle_new_user trigger creates the
//      personal organization, membership, settings and the default `reader` subscription);
//   2. upgrade that organization to the `operator` plan (reader strips tools:write, so no previews);
//   3. complete onboarding so the dashboard is reachable;
//   4. insert the engine alias → sandbox account map.
// Idempotent. Usage: node infra/seed/seed-demo.mjs .env
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const file = process.argv[2] ?? '.env';
const env = Object.fromEntries(readFileSync(file, 'utf8').split('\n')
  .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean).map((m) => [m[1], m[2]]));
const localhost = (url) => url.replace('host.docker.internal', '127.0.0.1');
const supabaseUrl = localhost(env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321');
const dbUrl = localhost(env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres');
const email = env.MARKTING_DEMO_EMAIL ?? 'demo@markting.local';
const password = env.MARKTING_DEMO_PASSWORD;
if (!env.SUPABASE_SECRET_KEY || env.SUPABASE_SECRET_KEY === 'from_supabase_status') throw new Error('SUPABASE_SECRET_KEY is not set; run make supabase-start first');
if (!password || password === 'generate_me') throw new Error('MARKTING_DEMO_PASSWORD is not set; run make env first');

const admin = createClient(supabaseUrl, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres(dbUrl, { max: 1 });

let userId;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Demo Media Buyer' } });
if (created.error) {
  if (!/already|exists|registered/i.test(created.error.message)) throw created.error;
  const [row] = await sql`select id from auth.users where email = ${email} limit 1`;
  if (!row) throw new Error('user exists but was not found');
  userId = row.id;
  console.log(`user ${email} already exists (${userId})`);
} else {
  userId = created.data.user.id;
  console.log(`created user ${email} (${userId})`);
}

const [membership] = await sql`select organization_id from public.organization_memberships where user_id = ${userId} order by created_at asc limit 1`;
if (!membership) throw new Error('no organization was created for the demo user (handle_new_user trigger missing?)');
const organizationId = membership.organization_id;

await sql`update public.organization_subscriptions set plan = 'operator', status = 'active', updated_at = now() where organization_id = ${organizationId}`;
await sql`
  insert into public.organization_onboarding (organization_id, current_step, selected_agent, completed_at)
  values (${organizationId}, 'complete', 'claude', now())
  on conflict (organization_id) do update set current_step = 'complete', completed_at = coalesce(public.organization_onboarding.completed_at, now()), updated_at = now()
`;
const aliases = [
  ['demo-google', 'sandbox', 'fixture-google-0001'],
  ['demo-meta', 'sandbox', 'fixture-meta-0001'],
  ['demo-reddit', 'sandbox', 'fixture-reddit-0001'],
];
for (const [alias, provider, accountId] of aliases) {
  await sql`
    insert into public.markting_account_aliases (organization_id, alias, provider, account_id, currency)
    values (${organizationId}, ${alias}, ${provider}, ${accountId}, 'USD')
    on conflict (organization_id, alias) do update set provider = excluded.provider, account_id = excluded.account_id
  `;
}
await sql.end({ timeout: 2 });
console.log(`organization ${organizationId}: plan=operator, onboarding complete, ${aliases.length} aliases`);
console.log(`Sign in at ${env.ADPORT_CLOUD_BASE_URL ?? 'http://localhost:3000'} with ${email} and MARKTING_DEMO_PASSWORD from ${file}`);
