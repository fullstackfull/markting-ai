-- PHASE B (B17/B18) — tenant-isolation RLS backstop (defense-in-depth).
--
-- WHY. The backend connects as the single pooled role `adport_backend` (lib/db.ts). That role is
-- nologin/noinherit, is NOT the table owner, and has no BYPASSRLS, so RLS applies to it — yet today
-- every tenant `public` table's backend policy is `… for all to adport_backend using(true) with
-- check(true)`, a no-op pass-through. Tenant isolation therefore lives ENTIRELY in the application's
-- `where organization_id = …` clauses. This migration adds a DB-level backstop UNDER that application
-- scoping; it never replaces it.
--
-- MECHANISM. For each tenant-owned `public` table with an `organization_id` column we KEEP the existing
-- permissive `_backend_*` policy and ADD a SEPARATE RESTRICTIVE policy, targeting `adport_backend` only,
-- keyed on the transaction-local GUC `app.current_organization_id`. Postgres AND-combines restrictive
-- policies with the (true) permissive one, so the effective predicate becomes exactly the restrictive
-- guard. The guard is written as a NO-OP WHEN THE GUC IS UNSET:
--
--     current_setting('app.current_organization_id', true) is null   -- unset → pass (service/job path)
--       or organization_id::text = current_setting('app.current_organization_id', true)
--
-- so single auto-commit reads/writes through `db()` (which never set the GUC) keep working across orgs,
-- while any transaction that opts in via `withTenant(orgId, …)` (lib/db.ts) is clamped to that org at the
-- DB layer for every table it touches. `set_config(…, true)` is transaction-local, matching the
-- `missing_ok = true` read above.
--
-- NULLABLE org tables (`markting_kill_switches`, `markting_change_records`, `billing_failures`) hold
-- platform-wide rows with a null organization_id; their guard also allows `organization_id is null` so
-- those global rows survive when the GUC is set.
--
-- DELIBERATELY NOT COVERED:
--   * Tables without an organization_id column — `public.organizations`, `public.profiles`,
--     `public.markting_encryption_keys` (global key store), and the platform-plane tables
--     (`platform_operators`, `platform_admin_audit`, `platform_plans`, `platform_feature_flags`,
--     `platform_settings`, `platform_admin_notifications`). Nothing to key a tenant guard on.
--   * `private.*` (e.g. private.apply_data_retention runs SECURITY DEFINER as the owner, bypassing
--     adport_backend policies — untouched here).
--   * The `adport_platform_admin` cross-tenant READ role: these policies target `adport_backend` only,
--     so the platform read path (lib/platform/db.ts) is entirely unaffected.
--
-- NO `FORCE ROW LEVEL SECURITY` is added (it would subject the owner-run SECURITY DEFINER retention path
-- to RLS). NO new table is created, so the migration-RLS CI checker is unaffected. Forward-only.

-- NOT-NULL organization_id — standard tenant guard.
create policy organization_memberships_backend_tenant_guard on public.organization_memberships
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy organization_settings_backend_tenant_guard on public.organization_settings
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy connections_backend_tenant_guard on public.connections
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy api_keys_backend_tenant_guard on public.api_keys
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy pending_operations_backend_tenant_guard on public.pending_operations
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy audit_events_backend_tenant_guard on public.audit_events
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy deletion_requests_backend_tenant_guard on public.deletion_requests
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy organization_subscriptions_backend_tenant_guard on public.organization_subscriptions
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy organization_ad_accounts_backend_tenant_guard on public.organization_ad_accounts
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy findings_backend_tenant_guard on public.findings
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy organization_onboarding_backend_tenant_guard on public.organization_onboarding
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy feedback_backend_tenant_guard on public.feedback
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy connection_events_backend_tenant_guard on public.connection_events
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy organization_entitlement_overrides_backend_tenant_guard on public.organization_entitlement_overrides
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy organization_ai_limits_backend_tenant_guard on public.organization_ai_limits
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_threads_backend_tenant_guard on public.markting_threads
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_account_aliases_backend_tenant_guard on public.markting_account_aliases
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_engine_proposals_backend_tenant_guard on public.markting_engine_proposals
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_sandbox_state_backend_tenant_guard on public.markting_sandbox_state
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_ai_usage_backend_tenant_guard on public.markting_ai_usage
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_business_context_backend_tenant_guard on public.markting_business_context
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_recommendations_backend_tenant_guard on public.markting_recommendations
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_recommendation_events_backend_tenant_guard on public.markting_recommendation_events
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_decision_events_backend_tenant_guard on public.markting_decision_events
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_recommendation_outcomes_backend_tenant_guard on public.markting_recommendation_outcomes
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_observation_jobs_backend_tenant_guard on public.markting_observation_jobs
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_memory_backend_tenant_guard on public.markting_memory
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_playbooks_backend_tenant_guard on public.markting_playbooks
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_experiments_backend_tenant_guard on public.markting_experiments
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_timeline_events_backend_tenant_guard on public.markting_timeline_events
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_creatives_backend_tenant_guard on public.markting_creatives
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_creative_assets_backend_tenant_guard on public.markting_creative_assets
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_creative_analysis_backend_tenant_guard on public.markting_creative_analysis
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_creative_clusters_backend_tenant_guard on public.markting_creative_clusters
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_creative_memberships_backend_tenant_guard on public.markting_creative_memberships
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_creative_signals_backend_tenant_guard on public.markting_creative_signals
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_store_connections_backend_tenant_guard on public.markting_store_connections
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_orders_backend_tenant_guard on public.markting_orders
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_order_lines_backend_tenant_guard on public.markting_order_lines
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_refunds_backend_tenant_guard on public.markting_refunds
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_products_backend_tenant_guard on public.markting_products
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_product_costs_backend_tenant_guard on public.markting_product_costs
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_commerce_sync_state_backend_tenant_guard on public.markting_commerce_sync_state
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_commerce_events_backend_tenant_guard on public.markting_commerce_events
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_profitability_config_backend_tenant_guard on public.markting_profitability_config
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_experiment_assignments_backend_tenant_guard on public.markting_experiment_assignments
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_experiment_observations_backend_tenant_guard on public.markting_experiment_observations
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_optimization_scenarios_backend_tenant_guard on public.markting_optimization_scenarios
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_scenario_constraints_backend_tenant_guard on public.markting_scenario_constraints
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_scenario_decisions_backend_tenant_guard on public.markting_scenario_decisions
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_operations_backend_tenant_guard on public.markting_operations
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_operation_approvals_backend_tenant_guard on public.markting_operation_approvals
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_service_accounts_backend_tenant_guard on public.markting_service_accounts
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_reconciliation_jobs_backend_tenant_guard on public.markting_reconciliation_jobs
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_provider_health_backend_tenant_guard on public.markting_provider_health
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));

-- NULLABLE organization_id (platform-wide / global rows) — also allow organization_id is null,
-- so global rows remain visible/writable even when the GUC is set.
create policy markting_kill_switches_backend_tenant_guard on public.markting_kill_switches
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy markting_change_records_backend_tenant_guard on public.markting_change_records
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id is null
         or organization_id::text = current_setting('app.current_organization_id', true));
create policy billing_failures_backend_tenant_guard on public.billing_failures
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id is null
         or organization_id::text = current_setting('app.current_organization_id', true));
