-- Phase 7 — controlled-execution governance + enterprise operations. Forward-only, additive,
-- tenant-scoped, RLS + revoke per the house convention. The ONLY legal mutation path is unchanged:
-- recommendation → typed action → policy validation → immutable preview → human approval → apply-time
-- revalidation → atomic claim → provider write → result → audit → outcome. These tables RECORD and
-- GOVERN that path; they add no autonomous write. Grants include UPDATE wherever a writer upserts
-- (ON CONFLICT DO UPDATE) — the Phase-4 lesson. No provider secrets are stored here.

-- Enterprise execution ledger (immutable progression; superset of the Phase-0 pending_operations preview).
create table if not exists public.markting_operations (
  operation_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id text,
  recommendation_id text,
  pending_operation_id uuid,                 -- the Phase-0 preview row this operation applies
  account_id text not null,
  provider text not null,
  action_type text not null check (action_type in ('SET_DAILY_BUDGET','PAUSE_ENTITY','RESUME_ENTITY')),
  entity_id text,
  entity_level text,
  state text not null default 'DRAFT' check (state in (
    'DRAFT','PREVIEWED','PENDING_APPROVAL','PARTIALLY_APPROVED','APPROVED','CLAIMED','APPLYING',
    'APPLIED','FAILED','UNKNOWN_RESULT','EXPIRED','SUPERSEDED','REJECTED','CANCELLED',
    'ROLLBACK_REQUESTED','ROLLED_BACK')),
  requester_user_id uuid references auth.users(id) on delete set null,
  policy_version text not null default 'v1',
  preview_digest text not null,
  idempotency_key text,
  claim_token text,
  trace_id text,
  risk_class text,
  before_state jsonb,
  requested_payload jsonb not null default '{}'::jsonb,
  provider_request jsonb,
  provider_result jsonb,
  after_state jsonb,
  failure_classification text,
  approval_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  primary key (organization_id, operation_id)
);
create index if not exists markting_operations_state_idx on public.markting_operations (organization_id, state, created_at);
create index if not exists markting_operations_account_idx on public.markting_operations (organization_id, account_id);

create table if not exists public.markting_operation_approvals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id text not null,
  approver_user_id uuid not null references auth.users(id) on delete cascade,
  roles jsonb not null default '[]'::jsonb,
  approved_at timestamptz not null default now(),
  primary key (organization_id, operation_id, approver_user_id),   -- a given actor approves at most once
  foreign key (organization_id, operation_id) references public.markting_operations (organization_id, operation_id) on delete cascade
);

-- Kill switches: cluster-safe authoritative storage (NOT the filesystem). organization_id is NULL for
-- platform-wide scopes (GLOBAL/PROVIDER/ACTION_TYPE). Backend-only.
create table if not exists public.markting_kill_switches (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('GLOBAL','ORGANIZATION','PROVIDER','ACCOUNT','ACTION_TYPE')),
  scope_key text not null default '',
  organization_id uuid references public.organizations(id) on delete cascade,
  active boolean not null default true,
  blocks_reads boolean not null default false,
  reason text,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  unique (scope, scope_key)
);
create index if not exists markting_kill_switches_active_idx on public.markting_kill_switches (active) where active;

create table if not exists public.markting_change_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  change_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  before_value jsonb,
  after_value jsonb,
  reason text not null,
  created_at timestamptz not null default now()   -- immutable (insert-only)
);
create index if not exists markting_change_records_org_idx on public.markting_change_records (organization_id, created_at);

create table if not exists public.markting_service_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  secret_hash text not null unique,
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists markting_service_accounts_prefix_idx on public.markting_service_accounts (key_prefix) where revoked_at is null;

create table if not exists public.markting_reconciliation_jobs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id text not null,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','APPLIED_CONFIRMED','SAFE_TO_RETRY','STILL_UNKNOWN','GAVE_UP')),
  attempts integer not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  next_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, operation_id),
  foreign key (organization_id, operation_id) references public.markting_operations (organization_id, operation_id) on delete cascade
);

create table if not exists public.markting_encryption_keys (
  version text primary key,
  state text not null check (state in ('ACTIVE','PREVIOUS','RETIRED')),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.markting_provider_health (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  account_id text not null default '',
  state text not null check (state in ('CONNECTED','DEGRADED','AUTH_EXPIRED','RATE_LIMITED','ERROR','DISABLED')),
  reason text,
  last_probe_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider, account_id)
);

-- Grants (UPDATE where ON CONFLICT DO UPDATE is used; insert-only tables get only select,insert).
grant select, insert, update on public.markting_operations to adport_backend;
grant select, insert on public.markting_operation_approvals to adport_backend;
grant select, insert, update on public.markting_kill_switches to adport_backend;
grant select, insert on public.markting_change_records to adport_backend;
grant select, insert, update on public.markting_service_accounts to adport_backend;
grant select, insert, update on public.markting_reconciliation_jobs to adport_backend;
grant select, insert, update on public.markting_encryption_keys to adport_backend;
grant select, insert, update on public.markting_provider_health to adport_backend;

-- RLS + revoke (house convention) on all eight tables.
do $$
declare t text;
begin
  foreach t in array array[
    'markting_operations', 'markting_operation_approvals', 'markting_kill_switches',
    'markting_change_records', 'markting_service_accounts', 'markting_reconciliation_jobs',
    'markting_encryption_keys', 'markting_provider_health'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_server_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)', t || '_server_only', t);
    execute format('drop policy if exists %I on public.%I', t || '_backend_all', t);
    execute format('create policy %I on public.%I for all to adport_backend using (true) with check (true)', t || '_backend_all', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
