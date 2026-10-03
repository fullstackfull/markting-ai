-- Phase 3 — decision history, outcome measurement, marketing memory, playbooks, experiments, timeline.
-- Forward-only, additive, tenant-scoped (every table keys on organization_id; FK'd + indexed). These
-- INFORM recommendations; they NEVER bypass the policy engine, approvals, budget limits, tenant
-- boundaries, human approval, or data-trust gates. Memory writes go through a deterministic service
-- (never the LLM); advertising/provider text may not become trusted memory. Audit history
-- (audit_events, pending_operations) remains immutable; business memory here is separately correctable.

-- 3A — recommendation lifecycle expansion + immutable linkage to the Phase-0 operation.
-- Append-only decision events. ACCEPTED (a recommendation was accepted) is a DIFFERENT fact from
-- EXECUTED (a provider write happened); they are distinct stages and never merged.
create table if not exists public.markting_decision_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id text not null,
  stage text not null check (stage in (
    'CREATED', 'REVIEWED', 'DISMISSED', 'ACCEPTED', 'PREVIEW_REQUESTED', 'PREVIEWED', 'APPROVED',
    'REJECTED', 'EXECUTED', 'EXECUTION_FAILED', 'EXPIRED', 'OUTCOME_PENDING', 'OUTCOME_MEASURED'
  )),
  account_id text,
  entity_id text,
  -- Immutable linkage to the Phase-0 governed operation (set once a preview/apply exists).
  pending_operation_id uuid,
  preview_digest text,
  actor_type text,
  actor_id text,
  -- Human modification (3N): the accepted idea's parameters were changed before execution.
  modified boolean not null default false,
  modification jsonb,
  -- Rejection reason (3M), optional and never required.
  rejection_reason text check (rejection_reason is null or rejection_reason in (
    'strategic_priority', 'insufficient_evidence', 'wrong_target', 'business_constraint',
    'creative_concern', 'budget_constraint', 'inventory', 'timing', 'other'
  )),
  -- Provider result when known (EXECUTED/EXECUTION_FAILED), copied from the Phase-0 apply, not guessed.
  provider_result jsonb,
  note text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, recommendation_id)
    references public.markting_recommendations (organization_id, id) on delete cascade
);
create index if not exists markting_decision_events_lookup_idx
  on public.markting_decision_events (organization_id, recommendation_id, created_at);
create index if not exists markting_decision_events_pending_idx
  on public.markting_decision_events (organization_id, pending_operation_id);

-- 3B/3C — before/after snapshots + deterministic outcome classification per observation window.
create table if not exists public.markting_recommendation_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id text not null,
  account_id text not null,
  entity_id text not null,
  window_label text not null, -- e.g. '24h' | '3d' | '7d' (chosen per category/provider, not universal)
  -- Structured baseline (3B): entity scope, metrics, window, currency, attribution, trust, timezone,
  -- target values, diagnosis, category — captured BEFORE execution.
  baseline jsonb not null,
  after_window jsonb,
  method text not null,
  expected_direction text,
  actual_direction text,
  classification text not null default 'OUTCOME_PENDING' check (classification in (
    'OUTCOME_PENDING', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'INCONCLUSIVE', 'INSUFFICIENT_DATA', 'CONTAMINATED'
  )),
  contamination jsonb not null default '[]'::jsonb,
  -- Causal restraint (3C): default is association, NOT causation.
  causal_stance text not null default 'NOT_ESTABLISHED' check (causal_stance in (
    'NOT_ESTABLISHED', 'OUTCOME_ALIGNED_WITH_RECOMMENDATION', 'TEMPORAL_ASSOCIATION', 'CAUSAL_EXPERIMENT_SUPPORTED'
  )),
  trust text,
  conclusion jsonb,
  -- Linkage to the modified action when the human changed parameters (3N).
  modified boolean not null default false,
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, recommendation_id, window_label),
  foreign key (organization_id, recommendation_id)
    references public.markting_recommendations (organization_id, id) on delete cascade
);
create index if not exists markting_recommendation_outcomes_org_class_idx
  on public.markting_recommendation_outcomes (organization_id, classification, created_at desc);

-- 3R — durable, idempotent, deduplicated outcome observation scheduling (NOT in-memory timers).
create table if not exists public.markting_observation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id text not null,
  window_label text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  dedup_key text not null,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedup_key),
  foreign key (organization_id, recommendation_id)
    references public.markting_recommendations (organization_id, id) on delete cascade
);
create index if not exists markting_observation_jobs_due_idx
  on public.markting_observation_jobs (status, scheduled_for)
  where status = 'scheduled';

-- 3E/3F — typed marketing memory with full provenance + trust. Memory is CORRECTABLE business state,
-- distinct from immutable audit history. A derived memory may never override an explicit human rule
-- (enforced in the service layer; trust ordering is explicit here).
create table if not exists public.markting_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in (
    'explicit_fact', 'human_preference', 'historical_decision', 'historical_outcome', 'operational_context'
  )),
  key text not null,
  value jsonb not null,
  -- Source is allowlisted: provider/ad content is NOT an allowed source for trusted memory (3T).
  source text not null check (source in (
    'human_config', 'human_confirmation', 'system_verification', 'derived_analysis', 'connected_source'
  )),
  source_reference text,
  trust text not null check (trust in (
    'EXPLICIT_HUMAN', 'SYSTEM_VERIFIED', 'DERIVED_HIGH_CONFIDENCE', 'DERIVED_LOW_CONFIDENCE', 'STALE', 'REVOKED'
  )),
  explicit boolean not null,
  confidence text,
  created_at timestamptz not null default now(),
  last_verified_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  unique (organization_id, category, key)
);
create index if not exists markting_memory_org_cat_idx
  on public.markting_memory (organization_id, category, trust)
  where revoked_at is null;

-- 3I — tenant playbook (one per org). Can constrain AI suggestions; can NEVER override Phase-0 safety.
create table if not exists public.markting_playbooks (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 3O — experiment model (future use; no autonomous launch in Phase 3).
create table if not exists public.markting_experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  hypothesis text not null,
  control jsonb,
  treatment jsonb,
  start_at timestamptz,
  end_at timestamptz,
  primary_metric text,
  guardrail_metrics jsonb not null default '[]'::jsonb,
  result jsonb,
  confidence text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'RUNNING', 'COMPLETE', 'ABANDONED')),
  created_at timestamptz not null default now()
);

-- 3P — observed account/campaign timeline events (recommendations/approvals/writes come from
-- decision_events + audit_events; this holds the externally-observed context: incidents, promotions).
create table if not exists public.markting_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id text not null,
  entity_id text,
  event_type text not null check (event_type in (
    'recommendation', 'approval', 'provider_write', 'human_change', 'tracking_incident',
    'promotion', 'performance_shift', 'outcome', 'memory_change'
  )),
  source text not null,
  occurred_at timestamptz not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists markting_timeline_events_lookup_idx
  on public.markting_timeline_events (organization_id, account_id, occurred_at desc);

grant select, insert on public.markting_decision_events to adport_backend;
grant select, insert, update on public.markting_recommendation_outcomes to adport_backend;
grant select, insert, update on public.markting_observation_jobs to adport_backend;
grant select, insert, update on public.markting_memory to adport_backend;
grant select, insert, update on public.markting_playbooks to adport_backend;
grant select, insert, update on public.markting_experiments to adport_backend;
grant select, insert on public.markting_timeline_events to adport_backend;

-- Row-level security + revoke, matching the markting_bridge house convention (belt-and-suspenders:
-- browser roles get no grant AND are blocked by a restrictive policy; the cloud server is adport_backend).
-- Also applied to the Phase-2 recommendation tables, which predated this convention on the branch.
do $$
declare t text;
begin
  foreach t in array array[
    'markting_decision_events', 'markting_recommendation_outcomes', 'markting_observation_jobs',
    'markting_memory', 'markting_playbooks', 'markting_experiments', 'markting_timeline_events',
    'markting_recommendations', 'markting_recommendation_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_server_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)', t || '_server_only', t);
    execute format('drop policy if exists %I on public.%I', t || '_backend_all', t);
    execute format('create policy %I on public.%I for all to adport_backend using (true) with check (true)', t || '_backend_all', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
