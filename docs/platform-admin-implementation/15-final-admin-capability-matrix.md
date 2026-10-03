# 15 — Final Admin Capability Matrix

Status at exit of this implementation program. READY = built, reachable, server-guarded, and CI-verified.
PARTIAL = backend/evidence exists and an honest stub surface is present, but the operator feature is not yet built.
DEFERRED = intentionally not built, with rationale.

| Capability | Status | Evidence / note |
|---|---|---|
| **Platform identity & authorization** | **READY** | `platform_operators` roster + guards + SELECT-only `adport_platform_admin` role + append-only `platform_admin_audit`; DB authz test + E2E. |
| **P0 kill-switch enforcement** | **READY** | `KillGuardedProvider` on the apply seam, fail-closed; real-Postgres test across all 5 scopes. |
| **Service-account hashing** | **READY** | peppered HMAC + constant-time; regression test. |
| **MCP token hygiene** | **READY** | daily purge scheduled + revoked-token cleanup (migration). |
| **Admin shell / IA** | **READY** | `app/(admin)/admin/*`, server-guarded, distinct chrome, full nav. |
| **Overview** | **READY** | cross-tenant KPIs; NOT_AVAILABLE where unsupported. |
| **Organizations (read + drill-down)** | **READY** | list (search/paginate) + detail. |
| **Org actions** | **PARTIAL** | freeze/unfreeze writes READY (enforced kill switch, audited); disable-AI/extend-trial/assign-plan/override/delete need backend. |
| **Users (read + drill-down)** | **READY** | directory + detail (email not exposed to read role, by design). |
| **User actions (suspend/sessions/keys/export)** | **PARTIAL** | need auth-provider session APIs. |
| **Plans catalog / entitlement overrides** | **PARTIAL** | hard-coded catalog preserved; DB catalog + overrides not built. |
| **Billing / MRR / revenue** | **PARTIAL** | Stripe sync exists; no operator revenue view / failed-payment queue / invoices yet. |
| **AI Operations** | **PARTIAL** | usage captured; fleet cost/quota/model controls not built; cost NOT_AVAILABLE in deterministic mode. |
| **Provider fleet health** | **PARTIAL** | per-org status shown; cross-tenant fleet view not built. |
| **Commerce fleet health** | **PARTIAL** | per-tenant data exists; fleet view not built. |
| **Jobs / System health** | **PARTIAL** | job tables exist, no runner/UI; no /health endpoint. |
| **Security Center** | **READY (baseline)** | posture + active kill switches + platform audit feed. |
| **Global Audit** | **PARTIAL** | platform-action audit READY; unified tenant+provider+billing audit with rich filters not built. |
| **Kill-switch UI (GLOBAL + per-org)** | **READY** | GLOBAL (SUPER_ADMIN) + per-org freeze, reason-required, audited, enforced. |
| **Support / customer health** | **PARTIAL** | feedback status lifecycle unused; triage/health not built. |
| **Feature flags** | **PARTIAL** | only env provider-rollout; DB flag model not built. |
| **Platform settings** | **PARTIAL** | stub; no secrets editable. |
| **Data quality fleet** | **PARTIAL** | per-tenant DQ exists; fleet view not built. |
| **Admin notifications** | **DEFERRED** | not built this program (roadmap Wave 19). |
| **Global search** | **PARTIAL** | per-section search (orgs/users) built; unified search not built. |
| **Impersonation** | **DEFERRED** | high-risk; no silent-login primitive built. Requires the bounded design in docs/platform-admin/12 (reason, short-lived, banner, start/end audit, action restrictions) before implementation. |
| **Admin E2E** | **READY** | operator access + tenant-owner/anon denial in a real browser. |
| **DB/RLS authz tests** | **READY** | tenant/browser cannot read platform data; role denials; append-only audit. |
| **Destructive-action four-eyes** | **PARTIAL** | SoD primitive exists and is reused for the apply path; a platform-level four-eyes wrapper for org-delete etc. is not built (those actions are not built yet). |
