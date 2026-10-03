-- Phase 2X — recommendation persistence + lifecycle history. Forward-only, additive, tenant-scoped.
-- A recommendation is a structured, human-reviewable artifact; it NEVER carries a provider endpoint/
-- path/body (the safety invariant lives in the app type, and the schema stores only a typed category
-- + review action). Accepting a recommendation moves its status to ACCEPTED_FOR_PREVIEW — it does NOT
-- mutate provider state; a real write still requires the Phase-0 human-approved preview/apply path.
-- The lifecycle events table prepares (but does not implement) Phase-3 outcome learning.

create table if not exists public.markting_recommendations (
  id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id text not null,
  entity_id text not null,
  entity_level text not null check (entity_level in ('account', 'campaign', 'ad_group', 'ad')),
  entity_name text not null,
  category text not null check (category in (
    'BUDGET_REVIEW', 'PAUSE_REVIEW', 'DELIVERY_REVIEW', 'TRACKING_REVIEW',
    'CREATIVE_REVIEW', 'TARGET_REVIEW', 'FUNNEL_REVIEW', 'ANOMALY_REVIEW', 'DATA_QUALITY_REVIEW'
  )),
  action_type text not null check (action_type in (
    'REVIEW_BUDGET_SCALE', 'REVIEW_BUDGET_REDUCE', 'REVIEW_PAUSE', 'REVIEW_DELIVERY',
    'REVIEW_TRACKING', 'REVIEW_CREATIVE_REFRESH', 'REVIEW_TARGET_SETTING', 'REVIEW_FUNNEL',
    'INVESTIGATE_ANOMALY', 'INVESTIGATE_DATA_QUALITY', 'NO_ACTION'
  )),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'REVIEWABLE', 'INSUFFICIENT_EVIDENCE', 'DISMISSED', 'ACCEPTED_FOR_PREVIEW', 'EXPIRED'
  )),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  risk text not null check (risk in ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  data_trust text not null,
  expected_impact text not null,
  diagnosis_type text not null,
  -- Structured bilingual reasoning, machine-readable evidence, and alternatives. No endpoint/body.
  reasoning jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  alternatives jsonb not null default '[]'::jsonb,
  -- Safety: always true. The column exists so the invariant is visible and enforceable at the DB.
  requires_human_approval boolean not null default true check (requires_human_approval = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (organization_id, id)
);

create index if not exists markting_recommendations_org_status_idx
  on public.markting_recommendations (organization_id, status, created_at desc);
create index if not exists markting_recommendations_org_entity_idx
  on public.markting_recommendations (organization_id, entity_id);

-- Lifecycle history: created/reviewed/dismissed/accepted/expired transitions, tenant-scoped. User
-- acceptance is recorded but is NOT treated as proof the recommendation was correct (Phase-3 work).
create table if not exists public.markting_recommendation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recommendation_id text not null,
  event text not null check (event in ('created', 'reviewed', 'dismissed', 'accepted_for_preview', 'expired')),
  actor_type text,
  actor_id text,
  note text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, recommendation_id)
    references public.markting_recommendations (organization_id, id) on delete cascade
);

create index if not exists markting_recommendation_events_lookup_idx
  on public.markting_recommendation_events (organization_id, recommendation_id, created_at);

grant select, insert, update on public.markting_recommendations to adport_backend;
grant select, insert on public.markting_recommendation_events to adport_backend;
