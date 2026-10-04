# 11 — Enterprise Readiness Review (Independent)

**Reviewer role:** Enterprise martech architect, evaluating MARKTING-AI for sale to global companies.
**Scope:** multi-tenancy, RBAC (tenant + platform, separation), platform admin, tenant admin, integrations
& connection lifecycle, data isolation (RLS), API architecture, extensibility, feature flags, billing, audit,
compliance readiness, scale, operational tooling.
**Method:** every claim grounded in code read directly. Paths are absolute from the repo root
(`platform/apps/cloud/*`, `platform/supabase/migrations/*`). Marketing/aspirational language is called out as such.
**Date:** 2026-10-04.

---

## 1. Evidence

### 1.1 Two-plane security model (platform vs tenant) — the strongest part of the system

- Tenant backend runs under Postgres role `adport_backend` (`lib/db.ts:13`, default in `lib/env.ts:9`).
- Platform cross-tenant **reads** run under a *physically separate* connection as the dedicated, **SELECT-only**
  role `adport_platform_admin` (`lib/platform/db.ts:17-27`). The migration that creates it grants only `select`
  and attaches a per-table `for select ... using(true)` policy in a loop
  (`20261014000000_platform_admin.sql:11-18,66-80`). A bug in an admin read query therefore *cannot* mutate tenant data.
- Platform **authority comes only from the `platform_operators` roster** — never from `organization_memberships`
  (`20261014000000_platform_admin.sql:20-34`; `lib/platform/auth.ts:30-44`). Four roles:
  `SUPER_ADMIN`, `PLATFORM_OPERATOR`, `SUPPORT_ADMIN`, `READ_ONLY_AUDITOR` (`lib/platform/auth.ts:11`).
  `requirePlatformOperator` / `requirePlatformRole` / `requirePlatformMutator` guard every admin route and
  server action server-side; `READ_ONLY_AUDITOR` can never mutate (`canMutate`, line 21-23).
- The `/admin` shell guards **every** route in the layout and renders `notFound()` for non-operators so the
  plane's existence is not disclosed (`app/(admin)/admin/layout.tsx:14-20`). Nav hiding is explicitly not the control.

This is textbook control-plane separation and is better than most shipping martech products.

### 1.2 Multi-tenancy & RLS (data isolation)

- Clean tenant model: `organizations`, `organization_memberships` (role enum owner/admin/member/viewer),
  `organization_settings`, per-org `connections`, `api_keys`, `audit_events`, `pending_operations`
  (`20260817171039_cloud_initial_schema.sql`). Auto-provisioning trigger creates org + owner membership on signup
  (lines 220-243).
- RLS is enabled on every table with a consistent house convention: `authenticated` gets a `restrictive ... using(false)`
  deny plus narrow member-scoped `select` policies; `adport_backend` gets `for all using(true)`; browser grants are
  revoked (lines 245-341; the markting_* tables repeat this via the loop in `20261011000000_phase7_governance.sql:140-155`).
- Secrets live in a separate `private` schema that is revoked from `public, anon, authenticated`
  (`...initial_schema.sql:1-2,335-336`). `api_keys` and `pending_operations` carry explicit `restrictive ... using(false)`
  deny policies so PostgREST stays closed even if a grant is added by accident (lines 300-303).
- **Maturity signal (both ways):** `20261012000000_phase1_rls_fixup.sql` documents and fixes a real P0 found in a
  prior reassessment — two Phase-1 tables (`markting_ai_usage`, `markting_business_context`) had been created with a
  backend grant only, which under Supabase's bootstrap `ALTER DEFAULT PRIVILEGES` left them cross-tenant
  readable/writable by any authenticated user via PostgREST. The fix is correct. That this slipped through at all is
  the core isolation concern (see §2).

### 1.3 Tenant RBAC

- `lib/cloud/tenant-admin.ts`: owner/admin gates (`requireMemberAdmin`), "only an owner can grant admin"
  (line 17), admins cannot change/remove owners or other admins (lines 96,127), last-owner protection on both role
  change and removal (lines 97-103,128-133), all mutations wrapped in transactions and audited.
- Write capability is plan- *and* role-gated: `applyPlanToPrincipal` strips `tools:write` unless the plan grants
  write access **and** the role is not `viewer` (`lib/cloud/plans.ts:144,154`).

### 1.4 Platform admin surfaces

- Broad operator surface under `app/(admin)/admin/*`: organizations, users, billing, plans, flags, AI, governance,
  integrations, support, notifications, security, system, data-quality, commerce, providers, search.
- Every privileged mutation is role-gated, **reason-required** (`assertReason` throws if < 3 chars,
  `lib/platform/audit.ts:22-26`), and writes exactly one row to the **append-only** `platform_admin_audit`
  (`lib/platform/ops-actions.ts` throughout; `lib/platform/audit.ts:28-39`). Examples: entitlement overrides,
  per-org AI disable/quota, plan-catalog edits (SUPER_ADMIN), feature flags, platform settings, billing-failure
  resolution, support status.

### 1.5 Integrations & connection lifecycle control plane

- Canonical single connection model (`public.connections`) extended with lifecycle metadata
  (`20261016000000_connection_control_plane.sql:12-26`) rather than a second model; an append-only
  `connection_events` trail (SELECT/INSERT only to backend) mirrors the admin audit (lines 39-73).
- Unified tenant read model (`lib/connections/read.ts`) derives status/health deterministically and is shared with
  the operator fleet view, so tenant and operator "never see divergent truth" (lines 11-19). No secrets are read.
- Operator actions (`lib/connections/platform-actions.ts`) are least-privilege and **honest**: there is deliberately
  no plaintext token-replacement UI; the strongest action is `disableConnection` (fails closed — disabled grants are
  never loaded into the runtime, enforced in `lib/cloud/repository.ts:212`) or `requestReauthorization`.
  `forceHealthRecheck` recomputes from stored signals and says so (line 62). `retryConnectionSync` openly records
  intent because "no in-repo background sync runner exists (BLOCKED_EXTERNAL)" (lines 117-127).

### 1.6 Credentials, crypto, OAuth

- Provider credentials: AES-256-GCM with AAD bound to `connection:{org}:{provider}`
  (`lib/crypto.ts:11-27`; used at `lib/cloud/repository.ts:172-177,200,219`). API keys are HMAC-SHA256 with a pepper
  and timing-safe compared (`lib/crypto.ts:33-41`). OAuth state is hashed, the verifier encrypted, single-use with
  `for update` (`lib/cloud/repository.ts:63-110`).
- A rotation-safe envelope KMS with a versioned keyring exists (`lib/markting/ops/kms.ts`) and a
  `markting_encryption_keys` table is defined (`...phase7_governance.sql:111-116`).

### 1.7 Safety / operational tooling (genuinely wired, not decorative)

- Cluster-safe kill switches (GLOBAL/ORGANIZATION/PROVIDER/ACCOUNT/ACTION_TYPE) stored in
  `markting_kill_switches` (`...phase7_governance.sql:58-70`) are enforced **at the provider apply seam** by
  `KillGuardedProvider.applyWrite`, which fails closed (`lib/markting/ops/kill-guarded-provider.ts:40-54`) and wraps
  both live and sandbox runtimes (`lib/cloud/runtime.ts:77`, `lib/markting/runtime.ts:33`). Global kill is
  SUPER_ADMIN-only (`app/(admin)/admin/governance/actions.ts`); per-org write-freeze uses the ORG-scope switch
  (`app/(admin)/admin/organizations/[id]/actions.ts`).
- Atomic compare-and-set claim prevents double-apply across containers
  (`lib/cloud/repository.ts:427-455`), with a full operation state machine (`markting_operations`,
  `...phase7_governance.sql:9-44`) and reconciliation jobs (lines 99-109).
- Durable per-key rate limiting keyed to the authenticated key, not client headers
  (`lib/cloud/auth.ts:31-35`, `lib/cloud/repository.ts:376-390`).
- No impersonation / session-takeover action exists in the platform plane — a positive for a security review.

### 1.8 Billing

- Stripe subscriptions with idempotent webhook processing (dedupe via `private.billing_events`,
  `lib/cloud/billing.ts:119-141`), org resolved from Stripe customer/subscription id — never the payload's claimed org
  (lines 66-74,157-162), plan downgrade auto-disables excess ad accounts (lines 92-106), payment-failure pipeline
  feeds the operator queue (`billing_failures`, lines 148-169). Single canonical entitlement resolver with an
  admin-editable catalog, per-org overrides, and a hard safety ceiling (`lib/cloud/plans.ts:55-104`).

### 1.9 DR / compliance documentation

- CI runs all migrations forward-only against real Postgres and asserts RLS, grants, composite FKs, and cross-tenant
  isolation (`docs/launch/02-database-backup-dr.md`). A logical restore + tenant-isolation drill is RUNTIME_PROVEN; a
  full cluster restore (PITR, RPO ≤ 5 min / RTO ≤ 60 min) is **BLOCKED_EXTERNAL / documented-only**.

---

## 2. Enterprise-readiness blockers

1. **No enterprise SSO/SAML/SCIM/OIDC, no enforced MFA.** Authentication is Supabase email + email-invite only
   (`lib/cloud/tenant-admin.ts:53`, `lib/cloud/auth.ts`). "SSO / regional hosting / SLA" appears **only** as billing
   marketing copy (`lib/i18n/messages/billing.ts:58`), with no implementation. No IdP-group→role mapping, no SCIM
   deprovisioning. For most global enterprises this alone fails procurement.

2. **Backend-layer tenant isolation is not enforced by RLS — it depends entirely on hand-written
   `where organization_id = $` clauses.** `adport_backend` holds `for all using(true)` on every tenant table, and all
   hot-path queries run through it (`lib/db.ts`, `lib/cloud/repository.ts`). RLS protects only the browser/PostgREST
   (`authenticated`) path. One missing predicate is a cross-tenant leak — precisely the bug class that already
   shipped once and had to be patched (`20261012000000_phase1_rls_fixup.sql`). There is no defense-in-depth
   (e.g. a session `app.current_org` GUC + `using(org = current_setting(...))`) on the backend path.

3. **Credential encryption is a single static env key with no rotation on the real path.**
   `ADPORT_CLOUD_ENCRYPTION_KEY` is one 32-byte key (`lib/crypto.ts:5-9`) and `provider_credentials.key_version` is
   hard-wired to `1` on every write (`lib/cloud/repository.ts:176`). The rotation-safe envelope KMS
   (`lib/markting/ops/kms.ts`) and `markting_encryption_keys` table exist but are **not wired** into actual credential
   storage. No cloud KMS/HSM (self-admitted BLOCKED_EXTERNAL, `kms.ts:5-6`), no per-tenant keys, no BYOK.

4. **No data residency / regional isolation.** Single Postgres, no region pinning, no EU/US data boundary; the
   promised "regional hosting" is unimplemented marketing. Full-cluster DR is documented but not provisioned
   (§1.9). Global enterprises with GDPR/data-locality requirements cannot be onboarded as-is.

5. **No compliance evidence.** No SOC 2 / ISO 27001 report, pen-test attestation, sub-processor list, or DPA found in
   code or docs. Several operational surfaces are intent-only (`retryConnectionSync`, live commerce transport,
   background sync runner — all BLOCKED_EXTERNAL). DSAR erasure is a synchronous hard cascade-delete in a request
   handler (`app/api/deletion/route.ts:21-26`) that bypasses the `deletion_requests` state machine the schema already
   defines (`...initial_schema.sql:184-197`) — functional but not an auditable, resumable erasure workflow.

**Secondary gaps:** two parallel API-credential systems (`public.api_keys` vs `markting_service_accounts`);
providers are hard-coded in CHECK constraints so adding one is a migration (`...initial_schema.sql:56`); the tenant
`audit_events` trail is only app-level append-only and is *deleted* by the retention cron
(`...initial_schema.sql:382-385`) — unlike the platform trail it is not DB-immutable; rate limiting is a coarse
per-minute DB bucket with no per-endpoint quotas.

---

## 3. Strengths

1. Exemplary **platform/tenant plane separation** — distinct Postgres roles, distinct connection, roster-sourced
   authority, SELECT-only cross-tenant reads, `notFound()` concealment.
2. **Append-only dual audit** (platform + connection) with reason-required, correlation-ID'd mutations and a clean
   4-tier platform RBAC including a true read-only auditor.
3. **Safety controls that are actually enforced** at the apply seam — fail-closed kill switches, atomic
   claim-and-apply, org write-freeze — not UI theater.
4. **Honest engineering**: BLOCKED_EXTERNAL gaps are labeled in code and messages, operators are deliberately denied
   plaintext token access, and a prior isolation P0 was found, documented, and fixed.
5. Mature **tenant RBAC + billing/entitlement** stack: last-owner protection, plan+role write gating, idempotent
   Stripe webhooks, single canonical entitlement resolver with a safety ceiling and per-org overrides.

---

## 4. Dimension scores (0–5)

| Dimension | Score | Basis |
|---|---|---|
| Multi-tenancy & data isolation (RLS) | 3 | Model solid, RLS present for browser path; backend isolation is WHERE-clause-only and leaked once. |
| Tenant RBAC | 4 | Clean roles, last-owner protection, admin-can't-touch-admin, plan-gated writes, audited. |
| Platform RBAC & plane separation | 5 | Separate role + connection, roster authority, 4 roles, server-guarded, concealed. |
| Platform admin surfaces | 4 | Broad, reason-required, audited; some surfaces record intent only. |
| Tenant admin | 4 | Members, settings, keys, account selection, retention — all audited and plan-aware. |
| Integrations & connection lifecycle | 4 | Canonical control plane, shared honest health, fail-closed disable; live sync BLOCKED_EXTERNAL. |
| Data isolation at backend layer | 2 | No RLS defense-in-depth; sole reliance on app predicates under an all-access role. |
| API architecture | 3 | Keys + MCP OAuth + scopes + durable limit; two parallel key systems, coarse limits. |
| Extensibility | 3 | Provider registry/packages + flags; providers hard-coded in CHECK constraints. |
| Feature flags | 4 | Global/plan/org scope, rollout %, audited; explicitly not authorization. |
| Billing | 4 | Stripe, idempotent webhooks, failure pipeline, canonical entitlements; enterprise price manual. |
| Audit | 4 | Dual append-only trails, correlation IDs; tenant trail only app-immutable + retention-deleted. |
| Compliance readiness | 2 | Primitives present; no SSO, KMS, residency, certifications, or auditable DSAR workflow. |
| Scale | 3 | Indexed hot paths, pooling, atomic claims, real-PG CI; single-region single-DB, no partitioning. |
| Operational tooling | 4 | Kill switches, freeze, incident scan, notifications, reconciliation, runbooks; no impersonation. |

---

## 5. Verdict

**WOULD_PILOT.**

The control-plane separation, fail-closed safety engineering, and dual append-only audit are genuinely
enterprise-grade in *design* — stronger than much of the shipping martech field — and the team demonstrates real
security maturity (finding and fixing its own isolation P0, refusing to build a token-replacement backdoor). But as a
product to **sell to global enterprises today**, five blockers stand in the way: no SSO/SAML/SCIM, tenant isolation on
the backend path that rests solely on hand-written WHERE clauses (no RLS defense-in-depth), single-static-key
credential encryption with the real rotation/KMS path unwired, no data residency, and no compliance evidence. These
are a focused hardening track, not a rewrite. A design-partner pilot with a security-tolerant customer is credible
now; a competitive enterprise procurement/security review would not pass until the blockers in §2 are closed.
