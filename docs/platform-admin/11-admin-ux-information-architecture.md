# 11 — Super Admin UX & Information Architecture (Proposed)

This is a **proposal**, grounded in the discovery evidence. It is NOT built.

## Principles (derived from the codebase)
1. **Physically separate from the tenant app.** A new top-level route group `app/(admin)/admin/*` with its own layout
   and its own guard (`requirePlatformOperator`), never reusing `requireDashboardTenant` (`lib/cloud/dashboard.ts:23`).
2. **Cross-tenant reads are new and dangerous.** Today 0 user-reachable queries cross orgs; every admin read-model is
   a *new* `adport_backend` cross-org query and must be built read-only, paginated, and audited. Treat the admin app
   as the first-ever legitimate cross-tenant reader.
3. **Read-first.** Ship observability (lists, drill-downs, health) before any mutation. Most operator value is
   visibility that is 100% absent today.
4. **Reuse tenant read logic per-org; add aggregation above it.** Drill-downs should call the existing org-scoped
   functions (`listConnections`, `getOrganizationEntitlement`, `listAuditEvents`, commerce/DQ loaders) with an
   operator-supplied org id — not reimplement them.

## Proposed `/admin` structure (improved vs the generic list)
The prompt's candidate list is reasonable; evidence-driven refinements:
- **Merge Plans + Subscriptions + Billing** into one **Billing & Plans** section — subscriptions are 1:1 with orgs
  (`organization_subscriptions` PK `organization_id`) and plans are tiny; three nav items would be mostly empty.
- **Fold Data Quality under Commerce** and **Incidents under System Health/Security** initially — these are thin
  today (DQ is per-batch per-tenant; no incident model exists), so they start as tabs, not top-level sections.
- **Add "Governance & Safety"** as a first-class section — it is the product's crown jewel (Phase-0, kill switch,
  SoD) and the home of the GAP-SEC-01 fix (kill-switch/freeze-writes controls).
- **Releases** stays minimal (link out to CI/deploy) — there is no in-repo release/deploy model to surface.

Recommended top-level nav:
1. **Overview** — platform KPIs (see `00` feasibility + below).
2. **Organizations** — list/search; drill into plan, members, connections, stores, usage, health, audit, lifecycle.
3. **Users** — list/search; drill into orgs, roles, sessions, keys, security events; suspend; (guarded) impersonate.
4. **Billing & Plans** — subscribers, MRR/ARR/churn, trials ending, failed payments; plan catalog + per-org overrides.
5. **AI Operations** — fleet + per-org/user/model cost, quota overrides, model routing/disable, failures/fallback.
6. **Providers** — fleet connection health, expiry forecast, revocations, rate-limit/outage, rollout control.
7. **Commerce** — fleet store/sync health, webhook failures, dead-letter backlog, DQ/COGS coverage (DQ as a tab).
8. **System Health** — jobs/queues/cron, worker heartbeat, retries/dead-letter; health/metrics federation (Incidents tab).
9. **Governance & Safety** — kill switches (once enforced), SoD/approvals oversight, runtime-mode posture, change log.
10. **Security & Audit** — global audit (filterable), security events, credential/KMS posture, session revocation.
11. **Support** — ticket triage (feedback.status), per-customer health, comms history.
12. **Feature Flags** — DB-backed flags by global/plan/org, rollout cohorts, emergency disable.
13. **Settings** — platform-operator roster & role assignment, admin audit of admin actions.

## Cross-cutting UX requirements
- Every destructive or sensitive action requires a **typed reason** (stored on the admin-audit row).
- An **org/user context switcher** that is explicit and logged (not the silent first-membership bind of
  `requireDashboardTenant`).
- A persistent **"you are acting as platform operator"** indicator, and a distinct, unmistakable **impersonation
  banner** when impersonating (see `12`).
- Every list is server-paginated and filterable (the tenant audit page's fixed 150-row, no-filter design
  `app/dashboard/audit/page.tsx:12-14` is the anti-pattern to avoid at platform scale).

## Overview KPI feasibility (data that actually exists)
| KPI | Feasible now? | Source |
|---|---|---|
| total users / orgs / active orgs | Yes (new cross-org count) | `auth.users`, `organizations`, `organization_memberships` |
| connected ad accounts / stores | Yes | `organization_ad_accounts`, `markting_store_connections` |
| subscriptions / trials | Yes | `organization_subscriptions` |
| MRR / ARR / churn | **No — needs billing read-model** | plan price (code) × active subs; churn needs history (not stored) |
| failed payments | **No — needs `invoice.*` webhook first** | not captured today (`04`) |
| AI requests / token cost / error rate | Partial (data exists, but gateway dormant ⇒ mostly empty) | `markting_ai_usage` |
| provider errors / connection health | Partial (3-state only) | `connections.status` |
| queue backlog / failed jobs | **No — needs a runner + reader** | job tables unread (`08`) |
| data-quality incidents | Partial (per-batch, not persisted fleet-wide) | `06` |
| approvals pending | Yes (per-org; aggregate is new) | `pending_operations` |
| security incidents | **No — not modeled** | `07` |
| onboarding conversion | Yes (new cross-org query) | `organization_onboarding.completed_at` |

Do not promise MRR/ARR/churn, failed-payments, queue, or security-incident KPIs on day one — they require backend
groundwork first (see `14`).
