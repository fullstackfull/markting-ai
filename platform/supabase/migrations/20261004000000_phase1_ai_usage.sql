-- Phase 1J — AI usage & cost ledger. Forward-only, additive. One row per (organization, request_id,
-- feature): the request_id is the idempotency key so a retry never double-charges. Estimated cost is
-- stored separately from any later provider-invoice reconciliation (not modeled here).

create table if not exists public.markting_ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  request_id text not null,
  thread_id text,
  feature text not null,
  model text not null,
  provider text not null,
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,
  latency_ms integer,
  status text not null check (status in ('ok', 'error', 'local_fallback', 'quota_exceeded')),
  -- Estimated cost in micros of the billing currency; NULL/0 for free local fallback. Never the
  -- authoritative invoice figure.
  estimated_cost_micros bigint not null default 0,
  tokens_available boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, request_id, feature)
);

create index if not exists markting_ai_usage_org_created_idx
  on public.markting_ai_usage (organization_id, created_at desc);

grant select, insert, update on public.markting_ai_usage to adport_backend;
