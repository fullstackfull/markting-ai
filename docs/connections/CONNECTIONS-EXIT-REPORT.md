# Connections & Integrations Control Plane — Exit Report

## Verdict
**READY as a code-only control plane.** MARKTING-AI now has ONE canonical integration domain powering both a
tenant Connection Center and a Super Admin Integration Operations Center — not two connection engines. Every
code-solvable capability (canonical lifecycle, deterministic status/health/error taxonomy, capability registry,
tenant ownership + RBAC, account discovery, scope intelligence, reauthorization, disconnect/revoke, audit,
admin fleet visibility, incident detection, security center, search, tests) is built, server-guarded and
CI-verified. Everything that needs real external credentials/infra is labelled BLOCKED_EXTERNAL and never faked.

## What shipped (READY)
- **Canonical domain** (`lib/connections/*`): one status vocabulary, one error taxonomy with deterministic
  remediation, one health machine (reused, now wired), a canonical read model unifying paid-media + commerce,
  an append-only `connection_events` trail. `public.connections` evolved (migration `20261016000000`); no
  duplicate identity created.
- **Capability registry** (`registry.ts`): one machine-readable map of auth type + capabilities per provider;
  the UI hides unsupported controls (no Refresh for meta/tiktok/x; manual-revoke note where no server revoke;
  no webhook for ad providers).
- **Tenant Connection Center** (`/dashboard/connections`): rich per-integration cards (status/health/accounts/
  env/auth/scopes/missing-scopes/expiry/errors+remediation/reauth banner), capability-gated actions
  (connect/test/reauthorize/discover/disconnect/retry), and a consistent wizard that never shows success
  before validation. Bilingual + RTL. All actions server-side, RBAC-gated, audited.
- **Super Admin Integration Operations Center** (`/admin/integrations` + provider/connection/search): fleet
  overview, provider & connection drill-down (no secrets), deterministic incident detection → notifications,
  Connection Security Center, capability catalog, connection search. Safe operator actions (recheck/request-
  reauth/disable-fails-closed/enable/retry) — role-gated, reason-required, append-only audited. No plaintext
  credential UI.
- **Security**: secrets stay backend-only (admin role has no access to `private.provider_credentials`); no
  secret on any read model or in the DOM; disabled connections fail closed at credential load.
- **Tests**: 32 pure-domain assertions (node lane), real-Postgres schema/append-only/isolation/no-secret
  tests (cloud-db lane), E2E operator fleet + tenant card + authz-denial + no-secret-in-DOM. Contract fixture
  provenance manifest (honest: no LIVE_CAPTURED).
- **Docs**: `docs/connections/00–12` + this report.

## BLOCKED_EXTERNAL (cannot be closed by code here)
Live provider OAuth + reads/writes; live contract capture; commerce live transport + webhook ingress;
background sync runner; live AI cost; edge System Health; GoTrue session/suspend/impersonation; live Stripe
truth. See `12-remaining-live-blockers.md`.

## Exit-gate check
Canonical lifecycle ✅ · security ✅ · tenant ownership ✅ · provider capabilities ✅ · account discovery (where
available) ✅ · health ✅ · errors ✅ · reauthorization ✅ · disconnect/revoke ✅ · sync visibility ✅ (runner
BLOCKED_EXTERNAL) · audit ✅ · admin visibility ✅ · tests ✅.

## Invariants
Platform RBAC separate from tenant RBAC; every sensitive mutation reason+audit; existing modules reused (no
duplication); Mode-B HELD; autonomous optimization DISABLED; tenant isolation intact; no fabricated
credentials; no live verification claimed without evidence.
