-- PHASE C.6 (item 5) — DATA QUARANTINE store.
--
-- Forward-only and additive. This is a PLATFORM-OPERATIONAL table in the same posture as the C.5 ops
-- tables (sync jobs / alerts / incidents): the backend role reads/writes it, the platform-admin read role
-- may SELECT, and there is deliberately NO authenticated/member policy — a tenant user can never read the
-- platform quarantine. RLS is enabled (satisfies the migration-RLS CI posture check).
--
-- A quarantined row is one the normalizer REFUSED to admit to canonical intelligence (malformed shape,
-- breaking schema drift, an impossible metric, an ownership mismatch, an unsupported currency, or an
-- invalid timestamp). This table is a DEDUPLICATED AGGREGATE: one row per (org, provider, account, reason)
-- carrying a running count, first/last-seen, and a SINGLE SAFE redacted sample. The sample is produced by
-- lib/markting/ops/sanitize.ts (sanitizeProviderResponse) BEFORE it ever reaches this table, so no raw
-- secret or full-PII value is ever persisted here — redacted_sample is shape only.

create table if not exists public.markting_quarantine (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  account_id text not null,
  reason text not null check (reason in (
    'MALFORMED_ROW','SCHEMA_DRIFT','IMPOSSIBLE_VALUE','OWNERSHIP_MISMATCH','UNSUPPORTED_CURRENCY','INVALID_TIMESTAMP'
  )),
  count bigint not null default 0,
  -- SAFE redacted sample ONLY. Written exclusively via the sanitizer; this must NEVER store a raw secret,
  -- token, or full-PII value. It is a structural shape for operator triage, not the offending row verbatim.
  redacted_sample jsonb not null default '{}'::jsonb,
  first_seen_at_ms bigint not null,
  last_seen_at_ms bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, account_id, reason)
);
comment on column public.markting_quarantine.redacted_sample is
  'Sanitizer-redacted structural sample ONLY — never a raw secret, token, or full-PII value.';
create index if not exists markting_quarantine_reason_idx on public.markting_quarantine (reason, last_seen_at_ms);
create index if not exists markting_quarantine_org_idx on public.markting_quarantine (organization_id, provider);

alter table public.markting_quarantine enable row level security;
create policy markting_quarantine_backend_read on public.markting_quarantine for select to adport_backend using (true);
create policy markting_quarantine_backend_insert on public.markting_quarantine for insert to adport_backend with check (true);
create policy markting_quarantine_backend_update on public.markting_quarantine for update to adport_backend using (true) with check (true);
create policy markting_quarantine_backend_delete on public.markting_quarantine for delete to adport_backend using (true);
create policy markting_quarantine_platform_admin_read on public.markting_quarantine for select to adport_platform_admin using (true);
grant select, insert, update, delete on public.markting_quarantine to adport_backend;
grant select on public.markting_quarantine to adport_platform_admin;
