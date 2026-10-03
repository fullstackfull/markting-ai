# 14 — Implementation Roadmap (Proposed, not executed)

Discovery-only mission: this is the recommended build order for a later program. Sequenced so safety prerequisites and
the authorization foundation land before any cross-tenant data or mutation.

## Exact implementation order (waves)

### Wave 0 — Safety prerequisite (MUST precede any admin mutation)
- **GAP-SEC-01**: wire `assertWriteNotKilled` into the single policy-engine write seam so the live apply path (and
  REST/MCP) actually honor kill switches; write a `kill_switch_change` record on every toggle. Do this before exposing
  any freeze/suspend control and before Mode-B exit.
- **GAP-SEC-02**: upgrade service-account hashing to peppered HMAC + constant-time compare (before anything wires
  service accounts).
- **GAP-OPS-02 / GAP-OPS-03**: schedule `purge_expired_mcp_oauth_records`; reconcile the retention/immutability
  contradiction on `audit_events`.

### Wave 1 — Authorization + data foundation (gates everything else)
- **GAP-AUTHZ-01**: `platform_operators` table + `requirePlatformOperator(minRole)` guard + roles (SA, PO, SUP,
  READ_ONLY_AUDITOR).
- **GAP-AUTHZ-02**: dedicated `adport_platform_admin` DB role + read-only cross-tenant RLS; org-filter lint rule.
- `platform_admin_audit` append-only log (retention-exempt) + reason-required middleware.
- Admin app shell `app/(admin)/admin/*` with its own layout, guard, and the impersonation-banner slot.

### Wave 2 — Read-first visibility (highest value, lowest risk)
- **GAP-OVR-01** Overview (feasible KPIs only), **GAP-ORG-01** Organizations directory + drill-down (reusing tenant
  loaders), **GAP-USR-01** Users directory, **GAP-PRV-01** provider fleet health, **GAP-COM-01** commerce fleet health,
  **GAP-AI-01** AI cost rollups. All read-only.

### Wave 3 — Billing & plans
- **GAP-BIL-02** invoice/payment-failure webhooks + failed-payment/trial-ending queue (backend, independent) →
  **GAP-BIL-01** revenue read-model → **GAP-PLN-02** per-org entitlement overrides → **GAP-PLN-01** DB-backed plan
  catalog → **GAP-ORG-03** extend-trial/assign-plan/credits. (BIL-03/BIL-04 later.)

### Wave 4 — Safe mutations & controls (on the enforced kill switch)
- **GAP-ORG-02** suspend/freeze/disable-AI, **GAP-AI-02** per-org quota overrides + disable, **GAP-AI-03** model
  routing/allowlist controls + gateway live-wiring, **GAP-FLG-01** DB feature flags (wrapping provider-rollout) →
  **GAP-PRV-03** rollout console.

### Wave 5 — Ops, security, support
- **GAP-OPS-01** job runner + UI, **GAP-OPS-04** health/metrics + correlation ids, **GAP-SEC-03** global audit,
  **GAP-SEC-04/USR-02/USR-03** sessions/suspend, **GAP-USR-04** impersonation (bounded per `12`), **GAP-SUP-01/02**
  support triage + customer health, **GAP-COM-02/AI-04/PRV-02** failure rollups & alerting.

### Wave 6 — Cleanup / nice-to-have
- GAP-ORG-04 staged delete+export, GAP-PLN-03 new entitlement dims, GAP-BIL-03/04, GAP-USR-05, GAP-COM-03, GAP-SUP-03.

## Recommended FIRST implementation wave (if only one ships)
**Wave 0 (SEC-01/02, OPS-02/03) + Wave 1 (AUTHZ-01/02 + admin shell + admin audit).** This delivers nothing
user-visible but makes every later admin feature *safe and possible*; skipping it means building cross-tenant power on
an app-code-filter-only guard and a false kill switch. Immediately after, **Wave 2 read-only Organizations + Overview**
gives the operator the single biggest jump in value (the SaaS owner can finally see their customers).

## Modules to REUSE (extend, don't reimplement)
- Org-scoped read loaders for drill-downs: `listConnections`, `listOrganizationAdAccounts`, `getOrganizationEntitlement`
  (`lib/cloud/plans.ts`), `listAuditEvents` (`repository.ts`), commerce/DQ loaders, `listOrganizationMembers`.
- The kill switch + SoD primitives (`lib/markting/ops/*`) — wire them, don't fork.
- `credential-rotation.ts` encryption, `crypto.ts` peppered HMAC, MCP-OAuth repository patterns.
- `provider-errors.ts` signal classification (extend into a persisted health enum).
- `applySubscription`/`processStripeEvent` (`billing.ts`) — extend the event set, don't parallel it.

## Modules that MUST NOT be duplicated
- **Entitlement resolution** — one resolver (`getOrganizationEntitlement`); overrides and DB catalog feed it, never a
  second path.
- **The write/apply seam** — kill switch, SoD, runtime-mode gating stay in the one policy-engine seam.
- **Auth/identity** — never a second "admin principal" bolted onto `requireDashboardTenant`; use a separate guard.
- **Feature gating** — one evaluator wrapping `provider-rollout.ts`, not a new parallel flag system.
- **Audit** — tenant `audit_events` stays tenant-scoped; platform actions go to the new `platform_admin_audit`, not
  mixed in.

## Migration needs
`platform_operators`, `platform_admin_audit` (append-only, retention-exempt), `organization_entitlement_overrides`,
`plans`/`entitlements` catalog (Wave 3), `organization_ai_limits`, `feature_flags`, billing failure/snapshot tables,
a richer `connection_status` (or a derived health table), persisted commerce/webhook failure counters; a new
`adport_platform_admin` DB role + RLS; `cron.schedule` for MCP purge. All **forward-only, additive** (matching the
repo's migration discipline).

## Test needs (per the repo's existing bar)
- Authz: `requirePlatformOperator` denies tenant users / service accounts / AI; per-role matrix; cross-tenant RLS role
  tests on a real Postgres (the repo already runs a `cloud-db` lane).
- Isolation: a cross-org query missing its filter must fail under RLS, not leak.
- Kill switch: live apply blocked under each scope; fail-closed; change record written (closes GAP-SEC-01).
- Billing: Stripe webhook fixtures for invoice/payment-failure/trial events; MRR math; idempotency.
- Impersonation: start/end audit events; banner present; destructive actions blocked; auto-expiry.
- Admin audit: every privileged mutation writes a reason-bearing row; retention-exempt.

## Security requirements (non-negotiable)
Separate platform identity (never tenant owner / service role / AI); two-layer enforcement (guard + RLS role);
reason-required + append-only audit on every privileged action; four-eyes on destructive actions; AI has no admin
mutation tools; Phase-0 invariants (no autonomous writes, Mode-B HELD) preserved; `MARKTING_E2E_TEST_AUTH` asserted-off
in production.
