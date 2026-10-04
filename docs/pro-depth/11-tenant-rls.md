# 11 — Tenant-isolation RLS backstop (B17/B18)

A defense-in-depth layer that enforces tenant isolation at the Postgres layer, **under** the existing
application-level `where organization_id = …` scoping. The WHERE clauses remain the primary authz
mechanism; this is an additional backstop, never a replacement.

## The gap it closes

The backend connects as one pooled role, `adport_backend` (`lib/db.ts`,
`connection.role = ADPORT_DB_ROLE`). That role is `nologin noinherit`, is **not** the table owner, and
has no `BYPASSRLS`, so RLS applies to it. But before this change every tenant `public` table's backend
policy was `… for all to adport_backend using(true) with check(true)` — a no-op pass-through. Tenant
isolation lived **entirely** in the app's WHERE clauses: a single missing `where organization_id = …`
would leak or cross-write another tenant's rows with nothing to catch it.

## Mechanism

### 1. Migration `20261018000000_tenant_rls_backstop.sql`

For each covered table it KEEPS the existing permissive `_backend_*` policy and ADDs a **separate
restrictive** policy targeting `adport_backend` only, keyed on a transaction-local GUC:

```sql
create policy <t>_backend_tenant_guard on public.<t>
  as restrictive to adport_backend
  using (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true))
  with check (current_setting('app.current_organization_id', true) is null
         or organization_id::text = current_setting('app.current_organization_id', true));
```

Postgres AND-combines restrictive policies with the `(true)` permissive one, so the effective predicate
is exactly the guard. The guard is a **deliberate no-op when the GUC is unset** (`current_setting(…,
true)` returns NULL with `missing_ok`), so it never breaks existing paths; it only bites once a
transaction sets the GUC. No `FORCE ROW LEVEL SECURITY` (that would subject the owner-run
`private.apply_data_retention()` SECURITY DEFINER path to RLS). No new table, so the migration-RLS CI
checker is unaffected.

Nullable-org tables carry platform-wide rows (`organization_id is null`); their guard adds
`or organization_id is null` so global rows survive when the GUC is set.

### 2. `withTenant(organizationId, fn)` — `platform/apps/cloud/lib/db.ts`

```ts
export async function withTenant<T>(organizationId, fn): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('app.current_organization_id', ${organizationId}, true)`;
    return fn(tx);
  });
}
```

`set_config(…, true)` is transaction-local — cleared on commit/rollback, never leaking to the next
checkout of the pooled connection. This is the path that arms the DB-level clamp.

Wired into the representative multi-statement tenant transactions in `lib/cloud/repository.ts`:

- `upsertProviderConnection` — upsert `public.connections` (+ private credential).
- `createApiKey` — insert `public.api_keys` + `public.audit_events`.
- `revokeApiKey` — update `public.api_keys` + insert `public.audit_events`.

These already used `db().begin(...)`; the change swaps `begin` for `withTenant` and is otherwise
behaviour-preserving. The wider repository was intentionally not refactored.

### The single-statement caveat

Single auto-commit statements issued directly through `db()` do **not** set the GUC. The restrictive
policy is a no-op for them, so cross-tenant service/job reads keep working and those statements rely on
their own WHERE clause (plus the no-op guard). `withTenant` is the only path that adds the DB-level
clamp. This is called out in both the migration header and the `withTenant` doc comment.

## Covered tables

All tenant-owned `public` tables with an `organization_id` column. **NOT-NULL org (standard guard, 55):**
`organization_memberships`, `organization_settings`, `connections`, `api_keys`, `pending_operations`,
`audit_events`, `deletion_requests`, `organization_subscriptions`, `organization_ad_accounts`,
`findings`, `organization_onboarding`, `feedback`, `connection_events`,
`organization_entitlement_overrides`, `organization_ai_limits`, and the `markting_*` domain tables:
`markting_threads`, `markting_account_aliases`, `markting_engine_proposals`, `markting_sandbox_state`,
`markting_ai_usage`, `markting_business_context`, `markting_recommendations`,
`markting_recommendation_events`, `markting_decision_events`, `markting_recommendation_outcomes`,
`markting_observation_jobs`, `markting_memory`, `markting_playbooks`, `markting_experiments`,
`markting_timeline_events`, `markting_creatives`, `markting_creative_assets`,
`markting_creative_analysis`, `markting_creative_clusters`, `markting_creative_memberships`,
`markting_creative_signals`, `markting_store_connections`, `markting_orders`, `markting_order_lines`,
`markting_refunds`, `markting_products`, `markting_product_costs`, `markting_commerce_sync_state`,
`markting_commerce_events`, `markting_profitability_config`, `markting_experiment_assignments`,
`markting_experiment_observations`, `markting_optimization_scenarios`, `markting_scenario_constraints`,
`markting_scenario_decisions`, `markting_operations`, `markting_operation_approvals`,
`markting_service_accounts`, `markting_reconciliation_jobs`, `markting_provider_health`.

**NULLABLE org (guard also allows `organization_id is null`, 3):** `markting_kill_switches`,
`markting_change_records`, `billing_failures`.

## Deliberately excluded

- **No `organization_id` column** — `public.organizations` (it *is* the org), `public.profiles`,
  `public.markting_encryption_keys` (global key store). Nothing to key a tenant guard on.
- **Platform-plane tables** — `platform_operators`, `platform_admin_audit`, `platform_plans`,
  `platform_feature_flags`, `platform_settings`, `platform_admin_notifications`. Global/operator data,
  no `organization_id`.
- **`private.*`** — `private.apply_data_retention()` is SECURITY DEFINER owned by the table owner, so it
  bypasses `adport_backend` policies; touching it would risk the retention path.
- **The `adport_platform_admin` cross-tenant READ role** (`lib/platform/db.ts`) — the policies target
  `adport_backend` only, so the platform read path is entirely unaffected (verified by test).

## Test matrix — `test/tenant-rls-backstop.database.test.ts`

Real Postgres only (`ADPORT_RUN_DATABASE_TESTS=1`, cloud-db lane; skips cleanly without a DB). Two orgs
seeded via the `auth.users → handle_new_user` trigger; representative table `public.findings` (full
backend CRUD). Backstop asserted under `set local role adport_backend` with the GUC set to org A:

| Case | GUC | Expectation |
| --- | --- | --- |
| SELECT org A's own rows | org A | returns them |
| SELECT org B's rows (and unscoped `select *`) | org A | returns none — clamp hides org B |
| INSERT a row for org B | org A | throws (`with check` violation) |
| UPDATE org B's rows | org A | 0 rows affected, org B row untouched |
| DELETE org B's rows | org A | 0 rows affected, org B row survives |
| SELECT across both orgs | unset | reads both — service-job path unbroken |
| `adport_platform_admin` SELECT across orgs | n/a | reads both (unaffected); write still fails (read-only role) |

## Validation run

- `cd platform/apps/cloud && pnpm exec tsc --noEmit` → pass.
- `cd platform/apps/cloud && ADPORT_RUN_DATABASE_TESTS=0 pnpm test` → 906 passed / 110 skipped; the new
  DB test skips cleanly (6 skipped, no import-time connection).
- `node platform/scripts/check-migration-rls.mjs` → OK (67 public tables enable RLS).
- The real-Postgres path (the 7 assertions above) runs on the cloud-db CI lane, not locally.
