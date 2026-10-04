-- PHASE C.5 — PRE-LIVE OPERATIONAL CLOSURE: durable sync queue, alert instances, incidents.
--
-- Forward-only and additive. These are PLATFORM-OPERATIONAL tables: the backend role reads/writes them;
-- the platform-admin read role may SELECT; there is deliberately NO authenticated/member policy, so a
-- tenant user can never read platform sync jobs, alerts, or incidents (operational data is operator-only).
-- RLS is enabled on every table (satisfies the migration-RLS CI posture check).

-- 1) Durable sync-job queue. The pure dispatch core (lib/markting/ops/sync-runner.ts) is the decision
--    logic; this table is the single persistence for it (no second queue implementation). A job carries
--    an org + provider + sync type, a monotone idempotency key (unique — a re-enqueue of the same unit of
--    work does not create a second row), lease fields for crash-recovery reclaim, and retry/backoff state.
create table if not exists public.markting_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  sync_type text not null check (sync_type in ('INITIAL','INCREMENTAL','REAUTH_REQUIRED','MANUAL_RETRY','WEBHOOK_TRIGGERED')),
  state text not null default 'QUEUED' check (state in ('QUEUED','LEASED','SUCCEEDED','RETRY_WAIT','DEAD_LETTER','CANCELLED')),
  idempotency_key text not null,
  priority int not null default 3,
  attempts int not null default 0,
  not_before_ms bigint not null default 0,
  lease_expires_at_ms bigint,
  lease_owner text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  enqueued_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, idempotency_key)
);
create index if not exists markting_sync_jobs_dispatch_idx
  on public.markting_sync_jobs (state, priority, enqueued_at_ms);
create index if not exists markting_sync_jobs_org_idx
  on public.markting_sync_jobs (organization_id, provider);

alter table public.markting_sync_jobs enable row level security;
create policy markting_sync_jobs_backend_read on public.markting_sync_jobs for select to adport_backend using (true);
create policy markting_sync_jobs_backend_insert on public.markting_sync_jobs for insert to adport_backend with check (true);
create policy markting_sync_jobs_backend_update on public.markting_sync_jobs for update to adport_backend using (true) with check (true);
create policy markting_sync_jobs_backend_delete on public.markting_sync_jobs for delete to adport_backend using (true);
create policy markting_sync_jobs_platform_admin_read on public.markting_sync_jobs for select to adport_platform_admin using (true);
grant select, insert, update, delete on public.markting_sync_jobs to adport_backend;
grant select on public.markting_sync_jobs to adport_platform_admin;

-- 2) Alert instances. One row per deduplicated alert key; delivery/cooldown/reopen/resolve are expressed
--    as state transitions on this row (no per-subsystem notification store).
create table if not exists public.markting_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null check (severity in ('INFO','WARNING','CRITICAL')),
  source text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  provider text,
  dedup_key text not null unique,
  correlation_id text not null,
  state text not null default 'OPEN' check (state in ('OPEN','DELIVERED','COOLDOWN','RESOLVED')),
  count int not null default 1,
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  cooldown_until timestamptz,
  incident_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists markting_alerts_state_idx on public.markting_alerts (state, last_seen_at);

alter table public.markting_alerts enable row level security;
create policy markting_alerts_backend_read on public.markting_alerts for select to adport_backend using (true);
create policy markting_alerts_backend_insert on public.markting_alerts for insert to adport_backend with check (true);
create policy markting_alerts_backend_update on public.markting_alerts for update to adport_backend using (true) with check (true);
create policy markting_alerts_platform_admin_read on public.markting_alerts for select to adport_platform_admin using (true);
grant select, insert, update on public.markting_alerts to adport_backend;
grant select on public.markting_alerts to adport_platform_admin;

-- 3) Incidents. Operator-owned. Affected orgs/providers are arrays; the timeline + notes are append-only
--    jsonb. Mutations happen through the backend role under a reason-required, audited admin action.
create table if not exists public.markting_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  severity text not null check (severity in ('INFO','WARNING','CRITICAL')),
  source text not null,
  state text not null default 'OPEN' check (state in ('OPEN','ACKNOWLEDGED','INVESTIGATING','MITIGATED','RESOLVED','POSTMORTEM_REQUIRED')),
  affected_organizations uuid[] not null default '{}',
  affected_providers text[] not null default '{}',
  correlation_id text,
  owner_operator_id uuid,
  started_at timestamptz not null default now(),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  timeline jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists markting_incidents_state_idx on public.markting_incidents (state, started_at);

alter table public.markting_incidents enable row level security;
create policy markting_incidents_backend_read on public.markting_incidents for select to adport_backend using (true);
create policy markting_incidents_backend_insert on public.markting_incidents for insert to adport_backend with check (true);
create policy markting_incidents_backend_update on public.markting_incidents for update to adport_backend using (true) with check (true);
create policy markting_incidents_platform_admin_read on public.markting_incidents for select to adport_platform_admin using (true);
grant select, insert, update on public.markting_incidents to adport_backend;
grant select on public.markting_incidents to adport_platform_admin;
