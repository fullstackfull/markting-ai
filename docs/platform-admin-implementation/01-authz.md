# 01 — Platform Authorization (WAVE 0 + WAVE 1)

## WAVE 0 — P0 safety (GAP-SEC-01): kill switch enforced on the apply seam
- `lib/markting/ops/kill-guarded-provider.ts` — `KillGuardedProvider` decorates any `AdProvider` and, in
  `applyWrite`, calls `assertWriteNotKilled(org, {organizationId, provider, accountId, actionType})` and throws
  `POLICY_VIOLATION` (fails closed) **before** the inner mutation. Reads/previews pass through.
- Wired in `lib/cloud/runtime.ts` (`scopeProvider` composes it over `AccountScopedProvider` for every live provider)
  and `lib/markting/runtime.ts` (demo sandbox). All write surfaces (dashboard apply route, REST, MCP) share these
  runtimes, so all inherit the guard; the demo path makes it CI-exercisable without live credentials.
- Scopes GLOBAL / ORGANIZATION / PROVIDER / ACCOUNT / ACTION_TYPE, evaluated via the existing
  `lib/markting/ops/kill-switch.ts` model; state in `markting_kill_switches` (cluster-safe DB).
- Tests: `test/kill-switch-enforcement.database.test.ts` (real Postgres) — each scope blocks apply with the inner
  mutation never reached; unaffected scope works; reads/previews continue; no caller (AI/service-account/stale
  approval) bypasses the single seam.

## WAVE 0.2 — service-account hashing
`lib/markting/ops/service-account.ts` now uses peppered HMAC-SHA256 (`digestApiKey`) + constant-time compare
(`safeEqual`), replacing unsalted SHA-256 + `!==`. Regression test `test/service-account-hash.test.ts`.

## WAVE 0.3 — MCP token hygiene
`20261013000000_mcp_oauth_purge_schedule.sql` schedules `private.purge_expired_mcp_oauth_records()` daily (was never
scheduled) and extends it to drop long-revoked refresh tokens.

## WAVE 1 — platform identity (separate plane)
Migration `20261014000000_platform_admin.sql` (forward-only, additive):
- **`platform_operators`** — roster: `user_id`, `role ∈ {SUPER_ADMIN, PLATFORM_OPERATOR, SUPPORT_ADMIN,
  READ_ONLY_AUDITOR}`, `status`, `created_by`, `last_used_at`. RLS on; backend-only policy (browser denied). **This is
  the sole source of platform authority — never organization_memberships.**
- **`platform_admin_audit`** — append-only (backend granted SELECT/INSERT only; no UPDATE/DELETE grant or policy),
  with actor, role, action, target, reason, correlation_id, before/after summaries. Separate from tenant
  `audit_events`, linkable by correlation_id.
- **`adport_platform_admin`** DB role — `nologin`, SELECT-only, granted cross-tenant SELECT + permissive read policies
  on the tenant tables the read-models consume. The browser never receives it.

Server layer (`lib/platform/`):
- `db.ts` `platformDb()` — the single trusted cross-tenant READ connection (SET ROLE `adport_platform_admin`,
  SELECT-only ⇒ an admin read bug cannot mutate tenant data). Platform mutations use the ordinary `db()` + a guard.
- `auth.ts` — `getSessionPlatformOperator` (resolves the signed-in user against the roster, stamps `last_used_at`),
  `requirePlatformOperator` (any active operator; 403 → `notFound()` in pages), `requirePlatformRole(...allowed)`,
  `requirePlatformMutator` (denies READ_ONLY_AUDITOR), `canMutate`/`isSuperAdmin`.
- `audit.ts` — `recordPlatformAdminAudit`, `assertReason` (sensitive mutations require a human-readable reason).

Two-layer enforcement: (1) every `/admin` page and every platform action calls a server guard; (2) cross-tenant reads
run under a SELECT-only DB role distinct from the tenant path. Nav hiding is never the control.

Tests: `test/platform-admin-authz.database.test.ts` (real Postgres) — a tenant user (browser/PostgREST) cannot read
the roster or audit; a tenant owner has no platform authority; `adport_platform_admin` can SELECT cross-tenant but is
denied INSERT on tenant tables; `platform_admin_audit` is append-only. `test/service-account-hash.test.ts` covers 0.2.
Browser authz: `e2e/admin.spec.ts` (operator access vs tenant-owner/anonymous denial).

## Threat-model mapping (WAVE 24, condensed)
- Tenant owner → platform admin: **blocked** — authority is the roster, not membership (DB test + @owner-denied E2E).
- Service account → platform admin: **blocked** — guards resolve a human session against the roster; service accounts
  never appear there.
- Cross-tenant read: only via the SELECT-only `adport_platform_admin` server path; browser roles denied by RLS.
- Admin mutation without reason/audit: **blocked** — `assertReason` + `recordPlatformAdminAudit` on every mutation;
  audit table is append-only.
- Kill-switch bypass: closed by WAVE 0 (enforced on the apply seam, fail-closed).
- READ_ONLY_AUDITOR mutation: **blocked** — `requirePlatformMutator`/`requirePlatformRole`.
