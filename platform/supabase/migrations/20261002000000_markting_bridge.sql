-- markting-ai: engine bridge tables.
--
-- These tables are additive to the upstream adport schema. They never hold a write path of
-- their own: approvals still live in public.pending_operations and are produced only by the
-- adport PolicyEngine. The bridge tables record provenance (which engine proposal became
-- which pending operation), chat thread ownership, the engine alias -> adport account map,
-- and the state of the credential-free sandbox provider used in demo mode.

-- Chat threads: the engine owns threads by a single service caller, so tenant isolation of
-- Assistant conversations is enforced here, keyed by organization and user.
create table public.markting_threads (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check (char_length(id) between 8 and 200)
);
create index markting_threads_org_idx on public.markting_threads (organization_id, last_message_at desc);

-- Engine alias -> adport provider/account. The engine never exposes provider account ids, so
-- the mapping has to live on this side. Demo mode seeds the three fixture aliases.
create table public.markting_account_aliases (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alias text not null,
  provider text not null,
  account_id text not null,
  currency text,
  targets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, alias),
  check (char_length(alias) between 1 and 200),
  check (provider ~ '^[a-z][a-z0-9_]*$')
);

-- Provenance: one row per (engine proposal, revision) the bridge handled.
create table public.markting_engine_proposals (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null,
  revision integer not null check (revision >= 1),
  thread_id text references public.markting_threads(id) on delete set null,
  engine_platform text not null,
  engine_account_ref text not null,
  engine_tool_name text not null,
  engine_target_ref text not null,
  payload_digest text not null,
  proposal jsonb not null,
  translation jsonb not null,
  pending_operation_id uuid references public.pending_operations(id) on delete set null,
  status text not null check (status in ('pending', 'unsupported', 'rejected_by_policy', 'applied', 'rejected', 'expired')),
  detail text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, proposal_id, revision)
);
create index markting_engine_proposals_pending_idx on public.markting_engine_proposals (pending_operation_id) where pending_operation_id is not null;

-- Sandbox provider state (demo mode only): the synthetic campaigns adport previews against.
create table public.markting_sandbox_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  campaigns jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.markting_threads enable row level security;
alter table public.markting_account_aliases enable row level security;
alter table public.markting_engine_proposals enable row level security;
alter table public.markting_sandbox_state enable row level security;

-- Browser roles never touch these tables; the cloud server (adport_backend) does.
create policy markting_threads_server_only on public.markting_threads as restrictive for all to authenticated
  using (false) with check (false);
create policy markting_account_aliases_server_only on public.markting_account_aliases as restrictive for all to authenticated
  using (false) with check (false);
create policy markting_engine_proposals_server_only on public.markting_engine_proposals as restrictive for all to authenticated
  using (false) with check (false);
create policy markting_sandbox_state_server_only on public.markting_sandbox_state as restrictive for all to authenticated
  using (false) with check (false);

create policy markting_threads_backend_all on public.markting_threads for all to adport_backend using (true) with check (true);
create policy markting_account_aliases_backend_all on public.markting_account_aliases for all to adport_backend using (true) with check (true);
create policy markting_engine_proposals_backend_all on public.markting_engine_proposals for all to adport_backend using (true) with check (true);
create policy markting_sandbox_state_backend_all on public.markting_sandbox_state for all to adport_backend using (true) with check (true);

revoke all on public.markting_threads, public.markting_account_aliases, public.markting_engine_proposals, public.markting_sandbox_state from anon, authenticated;
grant select, insert, update, delete on public.markting_threads, public.markting_account_aliases, public.markting_engine_proposals, public.markting_sandbox_state to adport_backend;
