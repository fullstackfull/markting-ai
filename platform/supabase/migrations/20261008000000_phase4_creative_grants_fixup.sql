-- Phase 4 follow-up — fix the markting_creative_assets grant and add a reverse-lookup index.
--
-- Root cause: `upsertCreative` inserts assets with `INSERT ... ON CONFLICT ... DO UPDATE`, which
-- requires BOTH insert AND update privilege. The Phase-4 migration granted only `select, insert` on
-- markting_creative_assets (markting_creatives correctly had `update`, which is why its own upsert
-- worked), so the asset upsert failed on the real-Postgres CI lane with
-- `permission denied for table markting_creative_assets`. Forward-only migrations are not re-applied,
-- so this additive migration grants the missing UPDATE (idempotent) and, defensively, re-asserts the
-- full grant set + RLS for the creative tables. ANALYSIS ONLY — nothing here publishes or modifies a
-- creative.

grant select, insert, update on public.markting_creatives to adport_backend;
grant select, insert, update on public.markting_creative_assets to adport_backend; -- +update: upsert does ON CONFLICT DO UPDATE
grant select, insert on public.markting_creative_analysis to adport_backend;       -- insert-only (ON CONFLICT DO NOTHING)
grant select, insert, update on public.markting_creative_clusters to adport_backend;
grant select, insert on public.markting_creative_memberships to adport_backend;    -- ON CONFLICT DO NOTHING
grant select, insert on public.markting_creative_signals to adport_backend;        -- plain insert

-- Reverse lookup (cluster membership by creative) without a scan.
create index if not exists markting_creative_memberships_creative_idx
  on public.markting_creative_memberships (organization_id, creative_id);

-- Re-assert RLS + revoke (house convention), idempotently, on all six creative tables.
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
