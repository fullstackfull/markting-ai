-- Phase 1G — tenant marketing/business context. Forward-only, additive. One row per organization;
-- only user-CONFIGURED values are stored (as JSON); KNOWN/DERIVED/UNKNOWN are computed at load time.
create table if not exists public.markting_business_context (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  configured jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.markting_business_context to adport_backend;
