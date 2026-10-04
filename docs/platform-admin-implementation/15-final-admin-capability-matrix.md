# 15 — Final Admin Capability Matrix

Status at exit. READY = built, reachable, server-guarded, CI-verified. PARTIAL = core built but a part
depends on external data/infra. DEFERRED = intentionally not built (rationale given).

| Capability | Status | Evidence / note |
|---|---|---|
| **Platform identity & authorization** | **READY** | `platform_operators` roster + guards + SELECT-only `adport_platform_admin` role + append-only `platform_admin_audit`; DB authz test + E2E. |
| **P0 kill-switch enforcement** | **READY** | `KillGuardedProvider` on the apply seam, fail-closed; real-Postgres test, all 5 scopes. |
| **Service-account hashing / MCP purge** | **READY** | peppered HMAC + constant-time; daily MCP purge scheduled. |
| **Admin shell / IA / nav** | **READY** | `app/(admin)/admin/*`, server-guarded, distinct chrome, full nav incl. Audit/DQ/Notifications/Search. |
| **Overview** | **READY** | cross-tenant KPIs; NOT_AVAILABLE where unsupported. |
| **Organizations (read + drill-down)** | **READY** | list (search/paginate) + detail (members, connections, accounts, AI, kill switches, override, AI limit). |
| **Org actions** | **READY** | freeze/unfreeze writes (enforced kill switch); entitlement override; AI disable/quota — all reason+audit, role-gated. |
| **Users (read + drill-down)** | **READY** | directory + detail (email not exposed to read role, by design). |
| **User actions (suspend/sessions/export)** | **PARTIAL** | needs auth-provider session APIs → BLOCKED_EXTERNAL. |
| **Plans & Entitlements** | **READY** | DB catalog (admin-editable) + per-org overrides, wired into the single resolver with safety ceiling; resolver DB-tested. |
| **Billing & Subscriptions** | **READY (core) / PARTIAL (external)** | MRR/ARR, subscribers, payment-failure capture + resolve queue. Invoice history / churn / tax-VAT-SAR = BLOCKED_EXTERNAL. |
| **AI Operations** | **READY (controls+rollups) / PARTIAL (cost)** | fleet cost by org/model, per-org disable+quota stored. Live cost + model routing = BLOCKED_EXTERNAL (dormant gateway). |
| **Provider Fleet Health** | **READY** | cross-tenant connection-status + provider-health rollups. |
| **Commerce Fleet Health** | **READY** | store/sync health, stuck-sync list, dead-letter count. |
| **Jobs / System Health** | **READY (read) / PARTIAL** | job-queue state + migration posture; no in-repo worker (runner roadmap); edge health = BLOCKED_EXTERNAL. |
| **Security Center** | **READY** | posture + active kill switches + platform audit feed. |
| **Global Audit** | **READY** | unified platform + tenant audit with org filter. |
| **Kill-switch UI (GLOBAL + per-org)** | **READY** | GLOBAL (SUPER_ADMIN) + per-org freeze; reason+audit; enforced. |
| **Support / Customer Health** | **READY** | ticket triage over feedback.status + deterministic customer-health score. |
| **Feature Flags** | **READY** | DB global/plan/org, server-eval, admin CRUD; never authorization. |
| **Platform Settings** | **READY** | non-secret JSON settings; secrets never stored here. |
| **Data Quality (fleet)** | **READY** | cross-tenant sync-gap/stale/errored view with drill-down. |
| **Admin Notifications** | **READY** | deduped inbox + generator script (schedulable); acknowledge action. |
| **Global Search** | **READY** | orgs / users / stripe customer+subscription ids. |
| **Impersonation** | **DEFERRED** | high-risk; no silent-login primitive. Requires the bounded design in docs/platform-admin/12 (reason, short-lived, banner, start/end audit, action restrictions) + auth-provider session APIs before build. |
| **Admin E2E** | **READY** | operator access (overview/orgs/users/security/billing/flags/audit) + tenant-owner/anon denial. |
| **DB/RLS authz tests** | **READY** | platform data isolation, role denials, append-only audit, override resolution, new-table RLS. |
| **Destructive four-eyes** | **PARTIAL** | SoD primitive reused on the apply path; a platform four-eyes wrapper for org-delete etc. is not built (org-delete itself not built). |
