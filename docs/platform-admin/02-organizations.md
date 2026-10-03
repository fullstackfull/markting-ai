# 02 — Organization / Customer Management (Discovery)

**Question:** can a platform admin manage organizations (customers)? **Answer: no — all org data is tenant-scoped;
there is no cross-org list, search, or mutation reachable by any user.**

Tables: `organizations` (`20260817171039_cloud_initial_schema.sql:24-31`), `organization_memberships` (`:35-44`),
`organization_settings` (`:46-51`), `organization_subscriptions` (`20260828120000...:3-15`),
`organization_ad_accounts` (`20260828120000...:17-31`), `organization_onboarding` (`20260828140646...:3-12`).

## Capability matrix (platform-operator lens)
| Capability | Status | Evidence |
|---|---|---|
| List all organizations | **MISSING** | `organizations_select_member` RLS requires membership (`:264-269`); no backend "list all orgs" fn reachable by a user |
| Search organizations | **MISSING** | no org-search path |
| Inspect plan | **TENANT-SCOPED** | `getOrganizationEntitlement` (`lib/cloud/plans.ts:55-79`), own org only |
| Inspect status | **TENANT-SCOPED** | `organization_subscriptions.status` (`20260828120000...:6-7`), set only by Stripe webhook (`billing.ts:78-89`) |
| Inspect members | **TENANT-SCOPED (owner/admin)** | `listOrganizationMembers` (`tenant-admin.ts:20-24`) via `app/api/members/route.ts` |
| Inspect ad accounts | **TENANT-SCOPED** | `listOrganizationAdAccounts(org)` (`repository.ts:700-708`) |
| Inspect connected providers | **TENANT-SCOPED** | `listConnections(org)` (`repository.ts:604-611`) |
| Inspect commerce stores | **TENANT-SCOPED** | `markting_store_connections` (`20261009000000_phase5_commerce.sql:7-21`), org-scoped |
| Inspect AI usage / token cost | **BACKEND-ONLY** | `markting_ai_usage` org-scoped; only quota-consumed (`ai-gateway.ts:79`), not surfaced |
| Inspect provider health | **BACKEND-ONLY / UNWIRED** | `markting_provider_health` (`...phase7_governance.sql:118-127`); `upsertProviderHealth` (`store.ts:163-168`) referenced only by tests |
| Inspect revenue / subscription | **TENANT-SCOPED, no rollup** | per-org subscription only; no aggregate revenue query anywhere |
| Inspect audit history | **TENANT-SCOPED** | `audit_events` per-org (`repository.ts:811-818`); governance `markting_change_records` (`...phase7_governance.sql:72-82`) is backend-only, no reachable caller |
| Inspect data quality | **TENANT-SCOPED** | `app/dashboard/data-quality/page.tsx:10` (org-scoped) |
| Inspect failures | **TENANT-SCOPED / UNWIRED** | `markting_reconciliation_jobs` (`...phase7_governance.sql:99-109`), `upsertReconciliationJob` org-scoped (`store.ts:155-159`), no cross-org view |
| Suspend organization | **BACKEND-ONLY (dormant)** | only mechanism is an ORGANIZATION-scope kill switch (`markting_kill_switches`, `...phase7_governance.sql:58-70`); `setKillSwitch` (`store.ts:131-136`) has no route/UI, test-only |
| Freeze writes | **BACKEND-ONLY (dormant + UNENFORCED)** | `assertWriteNotKilled` (`store.ts:138-145`) fails closed but is called only in tests; the live apply path `app/api/approvals/[id]/apply/route.ts` never calls it — see `07`/`13` GAP-SEC-01 |
| Disable AI | **MISSING as a toggle** | AI capped only by static gateway quota (`governance/page.tsx:51-57`); no per-org disable |
| Extend trial | **MISSING** | `trialing` only set by Stripe (`billing.ts:48-55`); no manual trial path |
| Manually assign a plan | **MISSING (Stripe-only / DB-only)** | plan changes flow only through `applySubscription` from the webhook (`billing.ts:57-117`); a human would need direct SQL as `adport_backend` |
| Add / remove credits | **MISSING** | no credits concept in schema |
| View onboarding completion | **TENANT-SCOPED** | `organization_onboarding.completed_at` joined in `requireDashboardTenant` (`dashboard.ts:36-40`), own org only |
| Delete org safely | **PARTIAL (owner self-serve hard delete)** | `deletion/route.ts:21` hard-deletes the owner's own org (cascade); not operator-driven, no staged/anonymized deletion |
| Export org data | **MISSING** | no export route |

## The decisive fact
There is **no query path that lists or acts across all orgs reachable by a user.** Everything is scoped to a single
org resolved from the caller's membership (`resolveMembership` `repository.ts:33-52`; `requireDashboardTenant`
`dashboard.ts:23-54`), enforced in depth by RLS on the browser path and by app-code `organization_id` filters on the
server path. The only non-org-filtered production queries are the Stripe webhook lookup (`billing.ts:67-72`), the
`apply_data_retention` cron, and the platform-wide kill-switch read (`store.ts:124-129`) — **none user-reachable**.

## Net
A platform Organizations console (list/search all tenants; drill into plan, members, connections, stores, usage,
health, revenue, audit; lifecycle actions suspend/freeze/disable-AI/extend-trial/assign-plan/credits/export/delete) is
**entirely greenfield**. Crucially, several lifecycle actions (suspend, freeze writes) have dormant backend primitives
that must first be *wired and enforced* (GAP-SEC-01) before an admin UI is built on them.
