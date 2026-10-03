-- Phase 1 RLS fixup (Coherence Program 0). Forward-only, additive, data-preserving.
--
-- The reassessment (docs/reassessment/06-security-hardening.md, P0) found that two Phase-1 tables were
-- created with a grant to adport_backend ONLY, skipping the house tenant-isolation convention that every
-- other markting_* table follows (RLS enabled + a restrictive `authenticated` deny policy + an
-- adport_backend policy + `revoke ... from anon, authenticated`). Under Supabase's bootstrap
-- ALTER DEFAULT PRIVILEGES (which grants table privileges to anon/authenticated), that omission left
-- both tables readable/writable cross-tenant by any authenticated user via PostgREST.
--
-- This migration brings `markting_ai_usage` and `markting_business_context` to the identical posture as
-- the Phase 2-7 tables. It changes no columns and drops no data; it only adds policies and revokes the
-- browser-role grants. The grants to adport_backend match the writers' needs (both tables upsert via
-- ON CONFLICT DO UPDATE, so UPDATE is required in addition to SELECT/INSERT).

-- Re-assert least-privilege grants for the server role (idempotent; same as the original migrations).
grant select, insert, update on public.markting_ai_usage to adport_backend;
grant select, insert, update on public.markting_business_context to adport_backend;

-- RLS + restrictive deny for browser roles + backend policy + revoke (house convention, as applied to
-- every Phase 2-7 table — see 20261011000000_phase7_governance.sql).
do $$
declare t text;
begin
  foreach t in array array[
    'markting_ai_usage', 'markting_business_context'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_server_only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (false) with check (false)', t || '_server_only', t);
    execute format('drop policy if exists %I on public.%I', t || '_backend_all', t);
    execute format('create policy %I on public.%I for all to adport_backend using (true) with check (true)', t || '_backend_all', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
