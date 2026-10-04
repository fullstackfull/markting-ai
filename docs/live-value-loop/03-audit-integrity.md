# 03 — Tenant Audit Append-Only (A3)

**Problem:** `public.audit_events` was append-only only by convention — `adport_backend` inherited
UPDATE/DELETE from the initial blanket grant and the backend RLS policy was `for all`.

**Fix (forward-only migration `20261017000000_audit_events_append_only.sql`):** `revoke update, delete on
public.audit_events from adport_backend` (the load-bearing step), and replace the `for all` backend policy
with split INSERT + SELECT policies — mirroring `platform_admin_audit` / `connection_events`. No deny trigger
needed. Safe: the app only ever INSERT/SELECTs audit_events; the retention purge runs through the
SECURITY DEFINER `apply_data_retention()` (owner rights, not the backend role) so it is unaffected; no new
table, so the migration-RLS CI checker is unaffected. Enforcement proven on real Postgres:
`test/audit-append-only.database.test.ts` (backend can INSERT/SELECT; UPDATE and DELETE are rejected).
