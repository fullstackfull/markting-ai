-- PHASE A (A3) — tenant audit append-only, enforced at the DB layer.
--
-- public.audit_events was append-only only by convention: adport_backend inherited UPDATE/DELETE from the
-- blanket `grant select, insert, update, delete on all tables ... to adport_backend` in the initial schema,
-- and the backend RLS policy was `for all`. This forward-only migration makes it append-only the same way
-- public.platform_admin_audit and public.connection_events already are: the backend role may INSERT and
-- SELECT only — UPDATE/DELETE are withheld.
--
-- Safety: the app only ever INSERTs/SELECTs audit_events (verified across the codebase — recordAudit +
-- siblings are inserts; reads are selects; no update/delete anywhere). The data-retention purge runs through
-- private.apply_data_retention(), which is SECURITY DEFINER, so its DELETE executes with the function
-- owner's rights, NOT adport_backend's — this REVOKE does not break retention. No new table is created, so
-- the migration-RLS CI checker is unaffected.

-- 1) The load-bearing step: withhold UPDATE/DELETE from the backend role (overrides the blanket grant).
revoke update, delete on public.audit_events from adport_backend;

-- 2) Make the posture self-documenting and consistent with platform_admin_audit: replace the `for all`
--    backend policy with a split INSERT + SELECT policy pair (RLS policies do not grant command privileges;
--    step 1 is what enforces append-only, but this keeps the policy surface honest). The existing
--    authenticated member SELECT policy (audit_events_select_member) is left intact.
drop policy if exists audit_events_backend_all on public.audit_events;
create policy audit_events_backend_insert on public.audit_events for insert to adport_backend with check (true);
create policy audit_events_backend_read on public.audit_events for select to adport_backend using (true);
