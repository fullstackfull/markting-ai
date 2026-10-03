-- Phase 4 — creative intelligence persistence. Forward-only, additive, tenant-scoped (org-keyed, FK'd,
-- indexed), RLS + revoke per the markting house convention. ANALYSIS ONLY: nothing here publishes or
-- modifies a creative. Analysis rows are VERSIONED (analysis_version + model + source_hash) and never
-- silently overwritten, so creative interpretation history is preserved for outcome tracking.

create table if not exists public.markting_creatives (
  id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  raw_id text not null,
  provider text not null,
  account_id text not null,
  campaign_id text,
  ad_group_id text,
  ad_id text,
  media_type text not null check (media_type in ('image', 'video', 'carousel', 'text', 'other')),
  status text,
  first_seen timestamptz,
  last_seen timestamptz,
  active boolean,
  text jsonb,
  performance jsonb not null default '{}'::jsonb,
  trust jsonb not null default '{}'::jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id)
);
create index if not exists markting_creatives_org_account_idx on public.markting_creatives (organization_id, account_id);
create index if not exists markting_creatives_org_campaign_idx on public.markting_creatives (organization_id, campaign_id);

create table if not exists public.markting_creative_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_id text not null,
  asset_id text not null,
  raw_asset_id text not null,
  provider text not null,
  media_type text not null,
  reference text,
  width integer,
  height integer,
  duration_sec numeric,
  format text,
  content_hash text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, creative_id, asset_id),
  foreign key (organization_id, creative_id) references public.markting_creatives (organization_id, id) on delete cascade
);
create index if not exists markting_creative_assets_hash_idx on public.markting_creative_assets (organization_id, content_hash);

-- Versioned analysis cache: unchanged (same source_hash + version) assets are not re-analyzed; prior
-- analytical history is preserved (insert-only; never overwrite a version that may back an outcome).
create table if not exists public.markting_creative_analysis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_id text not null,
  analysis_type text not null check (analysis_type in ('text', 'visual', 'video', 'fatigue', 'classification', 'lifecycle', 'rating')),
  analysis_version text not null,
  model text not null default 'none',
  source_hash text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, creative_id, analysis_type, analysis_version, source_hash),
  foreign key (organization_id, creative_id) references public.markting_creatives (organization_id, id) on delete cascade
);
create index if not exists markting_creative_analysis_lookup_idx on public.markting_creative_analysis (organization_id, creative_id, analysis_type);

create table if not exists public.markting_creative_clusters (
  id text not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  defining_features jsonb not null default '[]'::jsonb,
  sample_size integer not null default 0,
  performance jsonb not null default '{}'::jsonb,
  trust_tier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, id)
);

create table if not exists public.markting_creative_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cluster_id text not null,
  creative_id text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, cluster_id, creative_id),
  foreign key (organization_id, cluster_id) references public.markting_creative_clusters (organization_id, id) on delete cascade,
  foreign key (organization_id, creative_id) references public.markting_creatives (organization_id, id) on delete cascade
);

create table if not exists public.markting_creative_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  creative_id text not null,
  kind text not null,
  state text not null,
  confidence text,
  evidence jsonb not null default '{}'::jsonb,
  analysis_version text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, creative_id) references public.markting_creatives (organization_id, id) on delete cascade
);
create index if not exists markting_creative_signals_lookup_idx on public.markting_creative_signals (organization_id, creative_id, kind);

grant select, insert, update on public.markting_creatives to adport_backend;
grant select, insert on public.markting_creative_assets to adport_backend;
grant select, insert on public.markting_creative_analysis to adport_backend;
grant select, insert, update on public.markting_creative_clusters to adport_backend;
grant select, insert on public.markting_creative_memberships to adport_backend;
grant select, insert on public.markting_creative_signals to adport_backend;

-- RLS + revoke (house convention): browser roles get no grant AND a restrictive policy; server only.
do $$
declare t text;
begin
  foreach t in array array[
    'markting_creatives', 'markting_creative_assets', 'markting_creative_analysis',
    'markting_creative_clusters', 'markting_creative_memberships', 'markting_creative_signals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_server_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)', t || '_server_only', t);
    execute format('drop policy if exists %I on public.%I', t || '_backend_all', t);
    execute format('create policy %I on public.%I for all to adport_backend using (true) with check (true)', t || '_backend_all', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
