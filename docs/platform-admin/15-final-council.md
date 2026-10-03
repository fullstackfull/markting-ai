# 15 — Final Council & Verdict

Ten specialist perspectives on the evidence, then one synthesized verdict and the mission's required STOP summary.

## Specialist reviews
Each: strongest existing capability · biggest gap · biggest security risk · biggest operator pain · reuse · don't
duplicate · top-5 priorities.

### 1. SaaS product architect
Strongest: a coherent, fully tenant-scoped product with clean per-org read loaders. Biggest gap: zero platform plane —
the owner can't see their own business. Security risk: building cross-tenant power with no separate identity.
Pain: no Organizations list. Reuse: org loaders for drill-downs. Don't duplicate: entitlement resolver.
Top 5: AUTHZ-01, ORG-01, OVR-01, BIL-01, USR-01.

### 2. Platform/SRE engineer
Strongest: clean migrations, pg_cron present, fail-closed runtime gates. Biggest gap: queues with no runner + no job
UI; no health/metrics endpoints. Risk: unscheduled MCP purge (unbounded growth). Pain: no operational visibility.
Reuse: existing job tables + `next_attempt_at`/`attempts`. Don't duplicate: the write seam.
Top 5: OPS-01, OPS-02, OPS-04, OVR-01, PRV-01.

### 3. Security engineer
Strongest: peppered-HMAC API keys, PKCE MCP OAuth, SoD four-eyes, fail-closed runtime modes. Biggest gap: no platform
authz, no global audit. Risk: **GAP-SEC-01** — kill switch advertised but unenforced on the live path (a false safety
control the moment Mode-B opens). Pain: no security-event view. Reuse: SoD + kill-switch primitives, crypto.
Don't duplicate: auth/identity. Top 5: SEC-01, AUTHZ-01, AUTHZ-02, SEC-03, SEC-02.

### 4. Billing / FinOps expert
Strongest: clean Stripe subscription sync + idempotent webhook. Biggest gap: no revenue metrics, no payment-failure
path (ignores `invoice.*`). Risk: silent dunning failure → revenue leak. Pain: can't see MRR/churn/failed payments.
Reuse: `applySubscription`/`processStripeEvent`. Don't duplicate: entitlement resolver.
Top 5: BIL-02, BIL-01, PLN-02, ORG-03, BIL-04(SAR).

### 5. AI platform engineer
Strongest: governed gateway with allowlist, quota, ledger, fail-closed quota. Biggest gap: all of it is **dormant** —
not wired to a live path; quota is a code constant. Risk: operators assume AI controls exist; they don't. Pain: no
cost visibility. Reuse: gateway/ledger/quota. Don't duplicate: the gateway (wire it, add one live path).
Top 5: AI-01, AI-02, AI-03, SEC-01(AI-scope disable), OVR-01.

### 6. Customer-success operator
Strongest: a feedback table with a `status` lifecycle already present. Biggest gap: no triage, no customer-health, no
impersonation. Risk: support-login built unsafely. Pain: support is an email inbox; no customer context.
Reuse: `feedback.status`, per-org loaders for a health view. Don't duplicate: audit.
Top 5: SUP-01, USR-01, ORG-01, USR-04(bounded), SUP-02.

### 7. Senior frontend / admin-UX designer
Strongest: consistent tenant dashboard patterns to echo. Biggest gap: the tenant audit page (fixed 150 rows, no
filters) doesn't scale — platform lists need server pagination + filters. Risk: an admin that silently switches org
context (as `requireDashboardTenant` does). Pain: no overview. Reuse: component system. Don't duplicate: the tenant
layout/guard. Top 5: admin shell+guard (AUTHZ-01), OVR-01, ORG-01, explicit context switcher, impersonation banner.

### 8. Database / multi-tenant architect
Strongest: RLS on the browser path; disciplined additive migrations. Biggest gap/risk: server isolation is app-code
filters only (`adport_backend` bypasses RLS) — the single highest-leverage place a future cross-tenant admin query
leaks. Pain: no cross-org read-model exists to build on. Reuse: migration discipline. Don't duplicate: a second DB
access path. Top 5: AUTHZ-02 (admin RLS role), AUTHZ-01, org-filter lint rule, PLN-02(additive overrides),
snapshot tables for history.

### 9. Compliance / audit reviewer
Strongest: audit on tenant mutations; immutable-class retention intent. Biggest gap: no cross-tenant audit; auth
events never mirrored; governance change records unwritten. Risk: retention policy/impl contradiction deletes
"immutable" audit rows. Pain: can't answer "who did what across the platform". Reuse: `audit_events` shape.
Don't duplicate: mixing platform actions into tenant audit. Top 5: SEC-03, platform_admin_audit, OPS-03(reconcile),
SEC-01, reason-required actions.

### 10. Skeptical red-team reviewer
"Is any of this real?" — Tenant admin is real and audited; **no** platform admin exists (verified, not assumed). The
governance page over-claims (kill switch "blocks writes" — it doesn't on the live path). The dormant Phase-7 layer
could lull a builder into thinking controls work. Biggest risk: shipping an admin that wires the kill switch into a UI
without first enforcing it. Also: `MARKTING_E2E_TEST_AUTH` must never be on in prod. Don't trust the governance page
copy as behavior. Top 5: SEC-01 first, AUTHZ-01/02, prove isolation with RLS tests, don't over-claim controls.

## Synthesized verdict
MARKTING-AI has a **mature, safe, well-audited TENANT product and a genuinely strong safety-engineering substrate
(fail-closed runtime modes, SoD, peppered crypto, RLS on the browser path, dormant-but-built governance tables)** — and
**no platform/super-admin plane whatsoever.** The good news: much of the hard safety thinking is already done and the
per-tenant read logic is reusable. The risk: a large fraction of "operator" machinery is **built but unwired**
(kill switch, governance ledger, AI gateway, job queues), which can mislead a builder into exposing controls that don't
actually work. The correct program is **safety-prerequisite → authorization foundation → read-first visibility →
billing → safe controls → ops/security/support**, reusing existing modules and never forking the entitlement resolver,
the write seam, identity, feature gating, or audit.

---
## STOP SUMMARY (mission's 15 required answers)

1. **Current admin capabilities:** a complete TENANT admin — members (invite/role/remove, last-owner-protected,
   audited), API keys, connections, ad-account activation, policy/retention, billing (owner-only), onboarding, support
   widget — all org-scoped and mostly audited. Plus a strong but **dormant** governance substrate (kill switch, SoD,
   provider-health, AI gateway/ledger/quota) that is schema+library+tests only.
2. **Tenant-admin vs platform-admin:** everything today is TENANT (owner/admin/member/viewer, one org per principal).
   There is **no** platform-admin capability of any kind.
3. **Does a true Super Admin exist?** **No** — definitively (no `/admin`, no role/flag/table, no cross-tenant path).
4. **Missing features:** platform authz; cross-tenant read-models for users/orgs/AI/providers/commerce; billing
   revenue + payment-failure; plans catalog/overrides; AI cost/quota/routing controls; provider/commerce fleet health;
   job runner + ops UI; global audit + security center + session revocation; support triage + customer health;
   feature flags; impersonation; overview KPIs. (Full list in `13`.)
5. **P0/P1/P2/P3 counts:** **P0=1, P1=14, P2=22, P3=4 (41 total).**
6. **Recommended `/admin` architecture:** separate `app/(admin)/admin/*` with Overview, Organizations, Users, Billing
   & Plans, AI Operations, Providers, Commerce, System Health, Governance & Safety, Security & Audit, Support, Feature
   Flags, Settings (DQ/Incidents as tabs initially). See `11`.
7. **Recommended RBAC:** separate platform identity — ship **SUPER_ADMIN, PLATFORM_OPERATOR, SUPPORT_ADMIN,
   READ_ONLY_AUDITOR**; defer BILLING_ADMIN/SECURITY_ADMIN. Never reuse tenant owner / `adport_backend` / service
   accounts. See `12`.
8. **Recommended first implementation wave:** Wave 0 (SEC-01 kill-switch enforcement, SEC-02, OPS-02/03) + Wave 1
   (AUTHZ-01/02, admin shell, platform audit) — then read-only Organizations + Overview. See `14`.
9. **Modules to reuse:** org-scoped read loaders, kill-switch/SoD primitives, `credential-rotation`/`crypto`,
   MCP-OAuth patterns, `provider-errors` classification, `applySubscription`/`processStripeEvent`.
10. **Modules that must NOT be duplicated:** entitlement resolver, the write/apply seam, auth/identity, feature-gating
    evaluator, audit.
11. **Migration needs:** `platform_operators`, `platform_admin_audit`, `organization_entitlement_overrides`,
    plans/entitlements catalog, `organization_ai_limits`, `feature_flags`, billing failure/snapshot tables, richer
    connection-health, commerce/webhook failure counters, `adport_platform_admin` RLS role, MCP-purge cron — all
    forward-only/additive.
12. **Test needs:** platform-authz denial matrix; cross-tenant RLS isolation on real Postgres; kill-switch enforcement
    (closes SEC-01); Stripe failure/trial webhook fixtures + MRR math; impersonation start/end/banner/expiry; admin
    audit reason rows.
13. **Security requirements:** separate platform identity; two-layer enforcement (guard + RLS role); reason-required +
    append-only audit; four-eyes on destructive actions; no AI/service-account elevation; Phase-0 invariants preserved;
    `MARKTING_E2E_TEST_AUTH` off in prod.
14. **Exact implementation order:** Wave 0 safety → Wave 1 authz/foundation → Wave 2 read-first → Wave 3 billing/plans →
    Wave 4 safe mutations → Wave 5 ops/security/support → Wave 6 cleanup (`14`).
15. **Final council verdict:** strong tenant product + safety substrate, zero platform plane; proceed safety-first and
    authorization-first, reuse aggressively, and **enforce the kill switch (GAP-SEC-01) before building any admin
    control on top of it.**

**MISSION COMPLETE — DISCOVERY ONLY. No `/admin` was built; no code was modified. The one P0 (GAP-SEC-01) is latent,
not actively exploitable today, and is documented rather than fixed per the STOP rule.**
