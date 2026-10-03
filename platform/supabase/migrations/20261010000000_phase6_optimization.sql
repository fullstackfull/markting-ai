-- Phase 6 — experimentation + optimization persistence. Forward-only, additive, tenant-scoped, RLS +
-- revoke per the house convention. ANALYSIS/REVIEW ONLY: nothing here (or in the app) moves budget,
-- changes bids, pauses campaigns, launches experiments, or bypasses the Phase-0 approval path.
-- Grants include UPDATE wherever a writer upserts with ON CONFLICT DO UPDATE (the Phase-4 lesson).

-- Reuse the Phase-3 markting_experiments table; extend it forward-only for the Phase-6 canonical model.
alter table public.markting_experiments add column if not exists workspace_id text;
alter table public.markting_experiments add column if not exists type text;
alter table public.markting_experiments add column if not exists study_type text;
alter table public.markting_experiments add column if not exists assignment_method text;
alter table public.markting_experiments add column if not exists provider text;
alter table public.markting_experiments add column if not exists account_id text;
alter table public.markting_experiments add column if not exists entity_scope text;
alter table public.markting_experiments add column if not exists secondary_metrics jsonb not null default '[]'::jsonb;
alter table public.markting_experiments add column if not exists observation_window_days integer;
alter table public.markting_experiments add column if not exists sample_requirement jsonb;
alter table public.markting_experiments add column if not exists confidence_method text;
alter table public.markting_experiments add column if not exists contamination_flags jsonb not null default '[]'::jsonb;
alter table public.markting_experiments add column if not exists conclusion jsonb;
alter table public.markting_experiments add column if not exists recommendation_ref text;
alter table public.markting_experiments add column if not exists planned_end_at timestamptz;
alter table public.markting_experiments add column if not exists actual_end_at timestamptz;
-- Widen the status set to the Phase-6 lifecycle (forward-only: drop the old narrow check, add the new).
alter table public.markting_experiments drop constraint if exists markting_experiments_status_check;
alter table public.markting_experiments add constraint markting_experiments_status_check
  check (status in ('DRAFT','READY_FOR_REVIEW','APPROVED_FOR_LAUNCH','RUNNING','PAUSED','COMPLETED','INVALIDATED','INCONCLUSIVE','CANCELLED','COMPLETE','ABANDONED'));

create table if not exists public.markting_experiment_assignments (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  experiment_id uuid not null references public.markting_experiments(id) on delete cascade,
  arm text not null check (arm in ('control','treatment')),
  entity_id text not null,
  assigned_at timestamptz not null default now(),
  primary key (organization_id, experiment_id, arm, entity_id)
);

create table if not exists public.markting_experiment_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  experiment_id uuid not null references public.markting_experiments(id) on delete cascade,
  arm text not null,
  metric text not null,
  value numeric,
  currency text,
  observed_at timestamptz not null default now(),
  window_start timestamptz,
  window_end timestamptz
);
create index if not exists markting_experiment_observations_idx on public.markting_experiment_observations (organization_id, experiment_id, arm, metric);

create table if not exists public.markting_optimization_scenarios (
  scenario_id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id text,
  mode text not null check (mode in ('ALLOCATE_EXTRA','REDUCE','SIMULATE')),
  currency text not null,
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  trace jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, scenario_id)
);
create index if not exists markting_optimization_scenarios_created_idx on public.markting_optimization_scenarios (organization_id, created_at);

create table if not exists public.markting_scenario_constraints (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id text not null,
  kind text not null check (kind in ('hard','soft')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, scenario_id, kind),
  foreign key (organization_id, scenario_id) references public.markting_optimization_scenarios (organization_id, scenario_id) on delete cascade
);

create table if not exists public.markting_scenario_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id text not null,
  option_kind text not null,
  decision jsonb not null default '{}'::jsonb,
  -- human review status only; NEVER an execution record (execution goes through the Phase-0 path).
  review_status text not null default 'PROPOSED' check (review_status in ('PROPOSED','UNDER_REVIEW','ACCEPTED_FOR_PREVIEW','REJECTED')),
  created_at timestamptz not null default now(),
  foreign key (organization_id, scenario_id) references public.markting_optimization_scenarios (organization_id, scenario_id) on delete cascade
);
create index if not exists markting_scenario_decisions_idx on public.markting_scenario_decisions (organization_id, scenario_id);

-- Grants.
grant select, insert, update on public.markting_experiments to adport_backend;
grant select, insert on public.markting_experiment_assignments to adport_backend;
grant select, insert on public.markting_experiment_observations to adport_backend;
grant select, insert, update on public.markting_optimization_scenarios to adport_backend;
grant select, insert, update on public.markting_scenario_constraints to adport_backend;
grant select, insert, update on public.markting_scenario_decisions to adport_backend;

-- RLS + revoke (house convention) on the new tables + a re-assert on markting_experiments.
do $$
declare t text;
begin
  foreach t in array array[
    'markting_experiments', 'markting_experiment_assignments', 'markting_experiment_observations',
    'markting_optimization_scenarios', 'markting_scenario_constraints', 'markting_scenario_decisions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_server_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)', t || '_server_only', t);
    execute format('drop policy if exists %I on public.%I', t || '_backend_all', t);
    execute format('create policy %I on public.%I for all to adport_backend using (true) with check (true)', t || '_backend_all', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
