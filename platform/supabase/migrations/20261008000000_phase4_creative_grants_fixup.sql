-- Phase 4 follow-up — re-assert creative-table grants + RLS, and add a reverse-lookup index.
--
-- Why a second migration: the real-Postgres CI lane runs against a PERSISTED docker volume that is
-- reused across runs. A prior (cancelled/duplicate-dispatch) run left that volume with the Phase-4
-- creative tables present but the `markting_creative_assets` INSERT grant not in effect, and
-- forward-only `supabase migration up` never re-applies an already-recorded migration — so the grants
-- in 20261007000000 do not converge an existing volume. This additive migration always applies (new
-- version row) and re-asserts the full grant + RLS set idempotently, so any volume state converges.
-- Nothing here publishes or modifies a creative — ANALYSIS ONLY, unchanged.

grant select, insert, update on public.markting_creatives to adport_backend;
grant select, insert on public.markting_creative_assets to adport_backend;
grant select, insert on public.markting_creative_analysis to adport_backend;
grant select, insert, update on public.markting_creative_clusters to adport_backend;
grant select, insert on public.markting_creative_memberships to adport_backend;
grant select, insert on public.markting_creative_signals to adport_backend;

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
