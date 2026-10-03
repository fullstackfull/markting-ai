-- WAVE 1 — PLATFORM (SaaS operator) IDENTITY & AUTHORIZATION.
--
-- A completely separate security plane from tenant RBAC. An organization owner is NEVER a platform
-- operator; platform authority comes ONLY from the platform_operators roster below, never from
-- organization_memberships. Forward-only and additive. No tenant isolation is weakened.

-- 1) Dedicated platform READ role. Cross-tenant platform reads execute through this trusted,
--    server-only role (SET ROLE from the server's connection) — the browser never receives it, and it
--    is granted SELECT only, so an admin read path can never mutate tenant data. nologin + granted to
--    postgres so the server can SET ROLE into it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'adport_platform_admin') then
    create role adport_platform_admin nologin noinherit;
  end if;
end $$;
grant adport_platform_admin to postgres;
grant adport_platform_admin to adport_backend;
grant usage on schema public to adport_platform_admin;

-- 2) Platform operator roster — the SOURCE OF PLATFORM AUTHORITY.
create table public.platform_operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('SUPER_ADMIN','PLATFORM_OPERATOR','SUPPORT_ADMIN','READ_ONLY_AUDITOR')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.platform_operators enable row level security;
-- No anon/authenticated policy → the browser/PostgREST path sees nothing (RLS denies by default).
create policy platform_operators_backend_all on public.platform_operators for all to adport_backend using (true) with check (true);
create policy platform_operators_admin_read on public.platform_operators for select to adport_platform_admin using (true);

-- 3) Append-only PLATFORM ADMIN AUDIT — separate from tenant audit_events, linkable by correlation_id.
--    Backend may INSERT and SELECT; NOBODY gets UPDATE/DELETE (no policy, no grant) → append-only.
create table public.platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  platform_role text not null,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  correlation_id text,
  before_summary jsonb,
  after_summary jsonb,
  created_at timestamptz not null default now()
);
alter table public.platform_admin_audit enable row level security;
create policy platform_admin_audit_backend_insert on public.platform_admin_audit for insert to adport_backend with check (true);
create policy platform_admin_audit_backend_read on public.platform_admin_audit for select to adport_backend using (true);
create policy platform_admin_audit_admin_read on public.platform_admin_audit for select to adport_platform_admin using (true);
create index platform_admin_audit_created_idx on public.platform_admin_audit (created_at desc);
create index platform_admin_audit_actor_idx on public.platform_admin_audit (actor_user_id, created_at desc);

-- 4) Grants. Backend manages the roster and writes audit (SELECT/INSERT only on audit — no UPDATE/DELETE).
grant select, insert, update, delete on public.platform_operators to adport_backend;
grant select, insert on public.platform_admin_audit to adport_backend;
grant select on public.platform_operators, public.platform_admin_audit to adport_platform_admin;

-- 5) Cross-tenant READ posture for the platform read role over the tenant tables the admin read-models
--    consume. SELECT grant + a permissive select policy per table (the role is SELECT-only, so this
--    cannot widen write access anywhere).
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','organization_memberships','organization_settings','organization_subscriptions',
    'organization_ad_accounts','organization_onboarding','connections','audit_events','profiles','api_keys',
    'feedback','findings','pending_operations',
    'markting_ai_usage','markting_store_connections','markting_commerce_sync_state','markting_commerce_events',
    'markting_provider_health','markting_kill_switches','markting_operations','markting_operation_approvals',
    'markting_reconciliation_jobs','markting_change_records','markting_service_accounts','markting_recommendations'
  ] loop
    execute format('grant select on public.%I to adport_platform_admin', t);
    execute format('create policy %I on public.%I for select to adport_platform_admin using (true)', t || '_platform_admin_read', t);
  end loop;
end $$;
