-- WAVE 7-19 — platform-admin operational surfaces (forward-only, additive). All new public tables
-- enable RLS with a backend-only policy (browser denied) + a SELECT policy for the dedicated
-- adport_platform_admin read role. No tenant isolation is weakened; no secrets are stored here.

-- 1) PLANS CATALOG — admin-editable, seeded IDENTICALLY to lib/cloud/plans.ts so entitlement is
--    unchanged until an operator edits a row. The entitlement resolver prefers a row here, else the
--    hard-coded default (code fallback).
create table public.platform_plans (
  id text primary key check (id in ('reader','operator','premium','agency','enterprise')),
  name text not null,
  monthly_price_eur integer,
  annual_price_eur integer,
  max_active_accounts integer,
  max_members integer,
  max_retention_days integer not null,
  write_access boolean not null,
  client_workspaces boolean not null,
  archived boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.platform_plans enable row level security;
create policy platform_plans_backend_all on public.platform_plans for all to adport_backend using (true) with check (true);
create policy platform_plans_admin_read on public.platform_plans for select to adport_platform_admin using (true);
insert into public.platform_plans (id, name, monthly_price_eur, annual_price_eur, max_active_accounts, max_members, max_retention_days, write_access, client_workspaces) values
  ('reader','Free',0,0,3,1,30,false,false),
  ('operator','Operator',19,190,5,2,90,true,false),
  ('premium','Premium',79,790,15,5,365,true,false),
  ('agency','Agency',149,1490,40,15,730,true,true),
  ('enterprise','Enterprise',null,null,null,null,3650,true,true)
on conflict (id) do nothing;

-- 2) PER-ORG ENTITLEMENT OVERRIDES (GAP-PLN-02). NULL column = "no override, use plan value".
create table public.organization_entitlement_overrides (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  max_active_accounts integer,
  max_members integer,
  max_retention_days integer,
  write_access boolean,
  client_workspaces boolean,
  reason text,
  set_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.organization_entitlement_overrides enable row level security;
create policy org_entitlement_overrides_backend_all on public.organization_entitlement_overrides for all to adport_backend using (true) with check (true);
create policy org_entitlement_overrides_admin_read on public.organization_entitlement_overrides for select to adport_platform_admin using (true);

-- 3) PER-ORG AI LIMITS (quota override + hard disable).
create table public.organization_ai_limits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ai_disabled boolean not null default false,
  max_requests_per_window integer,
  max_cost_micros_per_window bigint,
  window_ms bigint,
  reason text,
  set_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.organization_ai_limits enable row level security;
create policy org_ai_limits_backend_all on public.organization_ai_limits for all to adport_backend using (true) with check (true);
create policy org_ai_limits_admin_read on public.organization_ai_limits for select to adport_platform_admin using (true);

-- 4) BILLING FAILURES — payment-failure pipeline (populated by the Stripe webhook).
create table public.billing_failures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider_customer_id text,
  provider_subscription_id text,
  event_type text not null,
  amount_due_minor bigint,
  currency text,
  attempt_count integer,
  next_attempt_at timestamptz,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.billing_failures enable row level security;
create policy billing_failures_backend_all on public.billing_failures for all to adport_backend using (true) with check (true);
create policy billing_failures_admin_read on public.billing_failures for select to adport_platform_admin using (true);
create index billing_failures_open_idx on public.billing_failures (resolved, created_at desc);

-- 5) FEATURE FLAGS — global / plan / org scope. Server-side evaluation only; never authorization.
create table public.platform_feature_flags (
  key text not null check (key ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  scope text not null check (scope in ('global','plan','org')),
  scope_key text not null default '',
  enabled boolean not null default false,
  rollout_percent integer not null default 100 check (rollout_percent between 0 and 100),
  reason text,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (key, scope, scope_key)
);
alter table public.platform_feature_flags enable row level security;
create policy platform_feature_flags_backend_all on public.platform_feature_flags for all to adport_backend using (true) with check (true);
create policy platform_feature_flags_admin_read on public.platform_feature_flags for select to adport_platform_admin using (true);

-- 6) PLATFORM SETTINGS — non-secret operational config (key/value JSON).
create table public.platform_settings (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
create policy platform_settings_backend_all on public.platform_settings for all to adport_backend using (true) with check (true);
create policy platform_settings_admin_read on public.platform_settings for select to adport_platform_admin using (true);

-- 7) ADMIN NOTIFICATIONS — operator inbox for high-value platform events (deduped by dedupe_key).
create table public.platform_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text not null,
  detail text,
  dedupe_key text not null,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.platform_admin_notifications enable row level security;
create policy platform_admin_notifications_backend_all on public.platform_admin_notifications for all to adport_backend using (true) with check (true);
create policy platform_admin_notifications_admin_read on public.platform_admin_notifications for select to adport_platform_admin using (true);
create unique index platform_admin_notifications_dedupe_idx on public.platform_admin_notifications (dedupe_key) where acknowledged = false;
create index platform_admin_notifications_open_idx on public.platform_admin_notifications (acknowledged, created_at desc);

-- Backend CRUD grants (mutations go through db()/adport_backend AFTER a platform guard) + read role grants.
grant select, insert, update, delete on
  public.platform_plans, public.organization_entitlement_overrides, public.organization_ai_limits,
  public.billing_failures, public.platform_feature_flags, public.platform_settings,
  public.platform_admin_notifications
  to adport_backend;
grant select on
  public.platform_plans, public.organization_entitlement_overrides, public.organization_ai_limits,
  public.billing_failures, public.platform_feature_flags, public.platform_settings,
  public.platform_admin_notifications
  to adport_platform_admin;
