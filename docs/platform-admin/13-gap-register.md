# 13 — Gap Register (P0–P3)

Every gap is a capability a professional Platform Super Admin needs that does **not** exist as a reachable, authorized
operator feature today. Fields per gap: persona · evidence · missing behavior · backend/UI/authz/audit status ·
dependencies · recommended implementation · duplicate-risk · tests.

**Counts:** P0 = 1 · P1 = 14 · P2 = 22 · P3 = 4 · **total 41.**
Persona key: SA=SUPER_ADMIN, PO=PLATFORM_OPERATOR, SUP=SUPPORT_ADMIN, BILL=billing, SEC=security, AUD=auditor.

---
## P0 — blocking prerequisite

### GAP-SEC-01 — Kill switch / write guard not enforced on the live write path
- **Persona:** SA/SEC/PO. **Evidence:** guard `assertWriteNotKilled` (`lib/markting/ops/store.ts:138-145`) is called
  only in tests; live apply path `app/api/approvals/[id]/apply/route.ts:30-31` never calls it; governance page
  advertises it as working (`app/dashboard/governance/page.tsx:60-63`).
- **Missing behavior:** an operator-set kill switch (GLOBAL/ORG/PROVIDER/ACCOUNT/ACTION) must actually halt approved
  writes. **Backend:** EXISTS (table `20261011000000...:56-70`, store fns). **UI:** none. **Authz:** n/a yet.
  **Audit:** change records table exists but unwritten.
- **Dependencies:** none (prerequisite for ORG-02, AI-02, Mode-B exit). **Recommended:** call `assertWriteNotKilled`
  inside `applyPending` / the single policy-engine seam so REST+MCP+dashboard inherit it; write a `kill_switch_change`
  record on every toggle. **Duplicate-risk:** HIGH if a parallel check is added — must live in the one write seam.
  **Tests:** apply blocked under each switch scope; fail-closed on unreadable switch state; change record written.
- **Note:** not exploitable today (writes already fail closed via `assertApplyAllowed`, Mode-B HELD); documented, not
  fixed, per the discovery-only STOP rule. **Must be fixed before any admin freeze/suspend control.**

---
## P1 — foundation + highest operator value

### GAP-AUTHZ-01 — No platform authorization model
- **Persona:** all. **Evidence:** only `organization_role` exists (`...cloud_initial_schema.sql:21`); no platform role/
  table/guard (`00`). **Missing:** `platform_operators` table + `requirePlatformOperator(minRole)` guard + roles per
  `12`. **Backend/UI/authz/audit:** none. **Deps:** gates every other admin gap. **Recommended:** see `12`.
  **Duplicate-risk:** HIGH — never reuse `requireDashboardTenant`/tenant `owner`/`adport_backend`. **Tests:** guard
  denies tenant users, service accounts, AI; allows only seeded operators; per-role matrix.

### GAP-AUTHZ-02 — Cross-tenant read-models need a safe data path
- **Persona:** SA/PO/AUD. **Evidence:** org isolation is app-code-filter-only; `adport_backend` bypasses RLS
  (`lib/db.ts:13`, `...cloud_initial_schema.sql:319-327`); 0 cross-org queries exist today. **Missing:** a dedicated
  `adport_platform_admin` DB role + RLS for read-only cross-tenant access, plus a lint/review rule for org filters.
  **Deps:** AUTHZ-01. **Recommended:** `12`. **Duplicate-risk:** med. **Tests:** cross-tenant read allowed only to
  admin role; tenant app unaffected; a missing-filter query fails under RLS rather than leaking.

### GAP-USR-01 — Platform user directory (list/search/profile/orgs/roles)
- **Persona:** PO/SUP/AUD. **Evidence:** `01` — only org-scoped `organization_member_directory`; `find_auth_user_id`
  is a single-email lookup. **Missing:** paginated/filterable cross-tenant user list → profile → orgs/roles/keys/usage.
  **Backend:** new read-model. **UI/authz/audit:** none. **Deps:** AUTHZ-01/02. **Recommended:** read-model over
  `auth.users`+`profiles`+`organization_memberships`; reuse per-user joins. **Duplicate-risk:** low. **Tests:**
  pagination, search, access denied to non-operators, no PII beyond scope.

### GAP-ORG-01 — Platform organization directory + drill-down
- **Persona:** PO/SUP/BILL/AUD. **Evidence:** `02`. **Missing:** list/search all orgs → plan, members, connections,
  stores, usage, health, audit. **Backend:** new aggregation + reuse org-scoped loaders with an operator org id.
  **UI/authz/audit:** none. **Deps:** AUTHZ-01/02. **Recommended:** `11` drill-down reuses `listConnections`,
  `getOrganizationEntitlement`, `listAuditEvents`, commerce/DQ loaders. **Duplicate-risk:** HIGH — reuse, don't fork.
  **Tests:** listing+search; drill-down parity with tenant view; authz.

### GAP-ORG-02 — Org lifecycle controls (suspend / freeze writes / disable AI)
- **Persona:** SA/PO/SEC. **Evidence:** `02` — only dormant ORG-scope kill switch. **Missing:** suspend org, freeze
  writes, disable AI, with reason + audit. **Backend:** kill switch exists but unenforced. **Deps:** **GAP-SEC-01**
  (hard prerequisite), AUTHZ-01. **Recommended:** build on the enforced kill switch; AI-disable needs AI-02.
  **Duplicate-risk:** HIGH — use the kill switch, don't add a second freeze path. **Tests:** suspend blocks tenant
  access/writes; audit + reason recorded; reversible.

### GAP-PLN-02 — Per-org enterprise entitlement overrides
- **Persona:** PO/BILL. **Evidence:** `03` — enterprise is one fixed row; no per-org override. **Missing:**
  `organization_entitlement_overrides` read by `getOrganizationEntitlement`. **Backend:** none. **Deps:** AUTHZ-01.
  **Recommended:** additive table merged over `PLANS[...]` in `plans.ts:55-79`; smallest high-value plans win.
  **Duplicate-risk:** med (keep one entitlement resolver). **Tests:** override applied; falls back to plan default;
  enforcement paths honor overrides.

### GAP-BIL-01 — Revenue read-model (subscribers, MRR/ARR/churn)
- **Persona:** BILL/SA. **Evidence:** `04` — no metrics anywhere. **Missing:** subscriber list + MRR/ARR; churn needs
  history. **Backend:** compute from `organization_subscriptions` × plan price; add a subscription-history/snapshot
  for churn. **Deps:** AUTHZ-01/02. **Recommended:** nightly snapshot table + aggregation. **Duplicate-risk:** low.
  **Tests:** MRR math vs fixtures; churn from history; authz.

### GAP-BIL-02 — Payment-failure handling + failed-payment/trial-ending queues
- **Persona:** BILL/PO. **Evidence:** `04` — webhook ignores `invoice.*`/`checkout.session.completed`; no dunning.
  **Missing:** handle invoice events, capture failures, operator queue + alerts. **Backend:** webhook extension +
  store. **Deps:** none (independent backend). **Recommended:** add handlers in `processStripeEvent`
  (`billing.ts:126-131`); persist failure/next-charge; queue read-model. **Duplicate-risk:** low. **Tests:** webhook
  fixtures for payment_failed/trial_will_end; idempotency; queue.

### GAP-AI-01 — Fleet + per-org/user/model AI cost dashboard
- **Persona:** SA/PO/BILL. **Evidence:** `05` — data in `markting_ai_usage`, only single-org sum, no UI. **Missing:**
  cross-org/user/model rollups + UI. **Backend:** new group-by queries. **Deps:** AUTHZ-01/02; real value needs AI-03
  (gateway wired) since usage is currently all free local-fallback. **Recommended:** read-model over
  `markting_ai_usage`. **Duplicate-risk:** low. **Tests:** rollup correctness; RLS (cost rows not cross-tenant to
  browser — already hardened `20261012000000...`).

### GAP-AI-02 — Per-org AI quota overrides + disable-AI-per-org
- **Persona:** SA/PO. **Evidence:** `05` — quota is a code constant; no per-org store/override. **Missing:** DB-backed
  per-org quota + enable/disable. **Backend:** move `DEMO_GATEWAY_CONFIG.quota` to a table read by `invoke`.
  **Deps:** AUTHZ-01; ties to ORG-02. **Recommended:** `organization_ai_limits` table; AI-disable via quota=0 or an
  AI-scoped kill switch. **Duplicate-risk:** med. **Tests:** per-org limit enforced; disable blocks calls fail-closed.

### GAP-PRV-01 — Fleet connection-health read-model + richer health states
- **Persona:** PO/SUP. **Evidence:** `06` — 3-state enum + free-text only; no fleet view. **Missing:** cross-org
  connection health; add `expired`/`rate_limited`/`degraded` classification. **Backend:** new read-model + state
  enrichment. **Deps:** AUTHZ-01/02. **Recommended:** aggregate `connections`; classify from `provider-errors.ts`
  signals + token expiry. **Duplicate-risk:** med (extend, don't fork `provider-errors.ts`). **Tests:** classification;
  aggregation; authz.

### GAP-COM-01 — Fleet commerce store/sync health
- **Persona:** PO/SUP. **Evidence:** `06` — per-tenant only. **Missing:** cross-org store list, failing/stuck-sync
  (high `consecutive_errors`) view. **Backend:** read-model over `markting_store_connections`+`markting_commerce_sync_
  state`. **Deps:** AUTHZ-01/02. **Recommended:** aggregation + thresholds. **Duplicate-risk:** low. **Tests:**
  stuck-sync detection; authz.

### GAP-OPS-01 — Job runner + operator job/queue UI
- **Persona:** PO. **Evidence:** `08` — `markting_reconciliation_jobs`/`markting_observation_jobs` have no consumer;
  no UI. **Missing:** a worker draining the queues + an operator view (state/retries/dead-letter). **Backend:** runner
  (none today). **Deps:** AUTHZ-01. **Recommended:** a scheduled worker + read-model; respect existing `next_attempt_
  at`/`attempts`. **Duplicate-risk:** med. **Tests:** drain, retry/backoff, give-up, dead-letter surfaced.

### GAP-OVR-01 — Platform Overview KPI dashboard
- **Persona:** SA/PO. **Evidence:** `11` KPI feasibility. **Missing:** overview of the feasible KPIs (users/orgs/active/
  accounts/stores/subs/trials/onboarding-conversion/pending-approvals). **Backend:** cross-org counts. **Deps:**
  AUTHZ-01/02; several KPIs blocked on BIL-01/OPS-01/AI-03. **Recommended:** ship feasible subset; mark the rest
  "coming" rather than fabricate. **Duplicate-risk:** low. **Tests:** count correctness; no fabricated metrics.

---
## P2 — important, after foundation
Compact entries (persona · evidence · recommendation · deps):

- **GAP-SEC-02** Service-account hashing weak (unsalted SHA-256 + non-constant-time compare, `service-account.ts:29,
  40`). Fix to peppered HMAC + `timingSafeEqual` **before** wiring service accounts. Deps: none. Tests: digest + compare.
- **GAP-SEC-03** No global filterable cross-tenant audit; auth events not mirrored (`07`). Build append-only platform
  audit + mirror/ingest GoTrue auth events; filterable by user/org/action/date/correlation id. Deps: AUTHZ-01/02.
- **GAP-SEC-04** No session revocation / security-event view (`07`). Add admin session listing + forced revocation via
  Supabase admin API; security-event feed. Deps: AUTHZ-01.
- **GAP-OPS-02** `purge_expired_mcp_oauth_records()` defined but unscheduled (`20260825120000_mcp_oauth.sql:71`).
  Add `cron.schedule`. Deps: none. Tests: expired rows purged.
- **GAP-USR-02** Suspend/reactivate user (`01`). Add status + enforcement at auth. Deps: AUTHZ-01, overlaps ORG-02.
- **GAP-USR-03** Session revocation (see SEC-04).
- **GAP-USR-04** Impersonation / support-login (`01`, design in `12`). Deps: AUTHZ-01; strict bounds mandatory.
- **GAP-ORG-03** Extend trial / assign plan manually / credits (`02`,`04`). Needs a credits ledger + manual-plan path.
  Deps: PLN-02, BIL-01.
- **GAP-ORG-04** Staged/safe org delete + export (`02`). Replace owner self-serve hard-delete with export-first,
  four-eyes. Deps: AUTHZ-01, SEC four-eyes.
- **GAP-PLN-01** DB-backed plan catalog (create/edit/clone/price/limits) (`03`). Migrate `PLANS` literal to a versioned
  table. Deps: PLN-02 first (overrides are higher value, lower risk). Duplicate-risk: HIGH — one entitlement resolver.
- **GAP-PLN-03** New entitlement dimensions: AI quota, commerce/store, API, provider, per-plan trial (`03`). Deps:
  PLN-01, AI-02.
- **GAP-BIL-03** Refunds/credits ledger + invoice access (`04`). Deps: BIL-01.
- **GAP-BIL-04** Tax/VAT + multi-currency incl. SAR (`04`). Deps: Stripe Tax + pricing model change.
- **GAP-AI-03** Model routing/allowlist/disable controls (DB-backed) + wire gateway into a live path (`05`). Deps:
  AUTHZ-01, AI-01. Duplicate-risk: med.
- **GAP-AI-04** Model health/failure/fallback inspection (`05`). Deps: AI-03 (needs live traffic).
- **GAP-PRV-02** Proactive token-expiry sweep + mass-refresh-failure alert (`06`). Add a cron sweep over stored
  `expiresAt`/`refreshExpiresAt`. Deps: OPS-01.
- **GAP-PRV-03** Provider-rollout operator console replacing the env allowlist (`10`). Deps: FLG-01.
- **GAP-COM-02** Webhook-failure + dead-letter backlog rollup + alerting (`06`). Persist failure counters. Deps:
  AUTHZ-02.
- **GAP-OPS-04** Health/metrics endpoints + correlation-id propagation (`08`). Add `/healthz` + request-id middleware;
  federate edge metrics. Deps: none.
- **GAP-SUP-01** Operator ticket triage over `feedback.status` (`09`). Smallest CS step. Deps: AUTHZ-01.
- **GAP-SUP-02** Customer-health + diagnostics console (`09`). Deps: USR-01, ORG-01, AI-01, PRV-01.
- **GAP-FLG-01** DB-backed feature flags (global/plan/org) + rollout + emergency disable (`10`). Wrap, don't fork,
  `provider-rollout.ts`. Deps: AUTHZ-01.

---
## P3 — nice-to-have / cleanup
- **GAP-OPS-03** Reconcile retention policy vs impl on `audit_events` immutability (`retention.ts:32` vs
  `...cloud_initial_schema.sql:382-385`). Compliance correctness.
- **GAP-USR-05** Export user data · merge identities · last-login (`01`).
- **GAP-COM-03** Cross-tenant DQ/COGS-coverage metrics (`06`).
- **GAP-SUP-03** Incidents/known-issues model · waitlist operator view/export (`cloud_waitlist` is write-only, private)
  · onboarding-funnel view (`09`).
