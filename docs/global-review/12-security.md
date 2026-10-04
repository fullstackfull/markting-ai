# 12 — Security & Privacy Review (Independent)

**Reviewer role:** SaaS AppSec / privacy, independent.
**Target:** MARKTING-AI cloud app, base `platform/apps/cloud` (the assignment's `lib/...` paths resolve under this app).
**Method:** Read the code; grounded every claim in a file path; verified enforcement against tests in `platform/apps/cloud/test/*` and the DB migrations in `platform/supabase/migrations/*`. No credit given for documentation without code/DB/test enforcement.

---

## Architecture facts that frame the whole review

- **Tenant isolation is enforced in application code, not RLS.** The data path connects over a direct Postgres connection as role `adport_backend` (`lib/db.ts`), and every tenant-table RLS policy grants that role `using (true) with check (true)` (`20260817171039_cloud_initial_schema.sql:319-327`, repeated per table in later migrations). RLS's real job here is to **deny the browser/PostgREST (`authenticated`/`anon`) role entirely** (e.g. the restrictive `*_server_only ... using(false)` policies in `20261012000000_phase1_rls_fixup.sql:29`). Consequence: the tenant boundary is the `where organization_id = ${...}` predicate present on effectively every query. A single missing predicate = tenant escape. I checked the hot paths and they are consistent (`lib/cloud/repository.ts`, `lib/markting/ops/store.ts`).
- **`organizationId` is always server-derived.** `sessionPrincipal` resolves membership from the signed-in Supabase user and, when an org is requested, re-validates membership for exactly that org (`lib/cloud/auth.ts:9-20`, `resolveMembership` `lib/cloud/repository.ts:35-54`). `apiPrincipal` derives the org from the stored API-key/OAuth-token row — never from a client header (`lib/cloud/auth.ts:22-37`). There is no code path that trusts a client-supplied `organization_id` without a membership check.
- **No raw SQL interpolation.** Every query uses the `postgres` tagged template (parameterized). `grep` for `db().unsafe` / `sql.unsafe` returns nothing. SQL-injection surface is effectively nil.

---

## Findings

### F-1 — Tenant `audit_events` is NOT DB-enforced append-only (integrity by convention) — MEDIUM
The platform operator audit (`public.platform_admin_audit`) is correctly append-only: it is granted only `select, insert` and has no UPDATE/DELETE policy or grant (`20261014000000_platform_admin.sql:70-78`), and a test asserts UPDATE/DELETE fail (`test/platform-admin-authz.database.test.ts:80`).

The **tenant** audit log `public.audit_events` does not get the same protection. The initial migration runs a blanket `grant select, insert, update, delete on all tables in schema public to adport_backend` (`20260817171039_cloud_initial_schema.sql:339`), which covers `audit_events`. There is **no trigger, rule, or revoke** restricting UPDATE/DELETE on it (confirmed: the only deletes are the `apply_data_retention` purge function at `:382` and `20260828120000:138`). So the comments calling it "immutable" (`20261006000000_phase3_memory_outcomes.sql:6`) describe app discipline, not a DB invariant. No application path currently updates/deletes it (verified by grep), so this is latent: a future bug or a compromised backend role can rewrite tenant history silently. **Enforced? No (convention only).** The same applies to `pending_operations` state history.

### F-2 — Whole-system compromise if `adport_backend` connection or its secrets leak — MEDIUM (design residual)
Because tenant isolation is purely the app-layer org predicate and the backend role bypasses RLS, anyone who obtains `SUPABASE_DB_URL`/`ADPORT_DB_ROLE` connectivity (SSRF to the DB, a `db().unsafe` introduced later, an injection) reads/writes **all tenants**. There is no second line (RLS with a per-request `SET app.current_org` GUC, which this design explicitly forgoes). This is an accepted-but-notable architecture risk, not a present bug. Encryption-at-rest for provider credentials (F-strength below) limits the blast radius to data, not provider tokens — a genuine mitigation.

### F-3 — E2E test-login route ships in the bundle, gated only by an env flag — LOW
`app/api/test/login/route.ts` performs a real Supabase `signInWithPassword` for an allowlist of four seeded `@e2e.test` emails, but only when `MARKTING_E2E_TEST_AUTH === '1'`. It is a hard 404 otherwise and cannot forge sessions or sign in arbitrary accounts (`:15-39`). Risk is entirely "flag must never be true in prod, and the seeded test password must never be set in prod." Defense-in-depth would be a build-time exclusion. **Enforced? Yes, conditionally (env flag).**

### F-4 — CSRF on cookie-authenticated mutation routes relies on SameSite + JSON content-type — LOW
Session-cookie POST routes (e.g. `app/api/approvals/[id]/apply/route.ts`, `account-selection`, `settings`, `members`) have no explicit CSRF token; they read JSON bodies. Supabase SSR cookies default to `SameSite=Lax`, and JSON POSTs are not simple-form-submittable, so classic CSRF is blocked in practice — but there is no explicit origin/CSRF check as belt-and-suspenders. **Residual, low.**

### F-5 — Access-token verification is symmetric (HS256) — INFORMATIONAL (not a weakness here)
MCP access tokens are HS256-signed with a server key (`lib/mcp-oauth.ts:168-181`) and additionally re-validated against the DB row with a full claim-equality check (`mcp-oauth-repository.ts:263-298`). Symmetric signing is fine because the same server issues and verifies, and the DB is authoritative. No action needed; noting it so a future multi-verifier topology revisits it.

---

## Things done notably right (verified, not just documented)

1. **Credential & token storage.** Provider secrets are AES-256-GCM encrypted with a 32-byte key and an **AAD that binds ciphertext to tenant+provider** (`connection:{org}:{provider}`) so a ciphertext cannot be replayed into another tenant/provider row (`lib/crypto.ts:11-27`, `repository.ts:172-200`). API keys are stored as HMAC-SHA256 with a server pepper, never plaintext (`crypto.ts:33-35`, `repository.ts:338-355`); key format is regex-gated before any lookup. PKCE verifiers at rest are encrypted with the same tenant-bound AAD (`repository.ts:71-77`). Tested in `test/crypto.test.ts`.
2. **Provider OAuth flow.** State is `sha256`-hashed at rest, **single-use** via `SELECT ... FOR UPDATE` + `consumed_at`, bound to the initiating user and org, and 10-minute expiry (`repository.ts:63-110`). The callback **re-authorizes** against the transaction's org after consent (membership/role may have changed) and re-checks owner/admin (`callback/route.ts:52-61`). Redirects only ever use the configured base URL, never the inbound Host header (`callback/route.ts:23-28`). Duplicate `code`/`state` params are rejected (`:51`). Return paths pass through `safeReturnPath` (no `//`, no backslash, same-origin only — `lib/return-path.ts`).
3. **MCP OAuth (RFC 8707-style).** PKCE **S256 required** with challenge-format validation (`mcp-oauth.ts:131-133,147-150`); redirect URIs **exact-match an allowlist**, HTTPS or loopback-HTTP only, no creds/fragment (`:80-99`); `resource` must exactly equal the configured `/mcp` audience (`:109-123`); authorization codes are single-use (`FOR UPDATE` + `consumed_at`) and bound to client+redirect+resource (`mcp-oauth-repository.ts:182-212`); refresh tokens rotate with a bounded reuse-grace window and reject down-scope-exceeding requests (`:215-261`); scopes limited to `tools:read|tools:write`. Tested in `test/mcp-oauth*.ts`.
4. **Provider-write safety (Mode-B hold + kill switch).** Every live and sandbox provider is wrapped in `KillGuardedProvider` at the single `createTenantRuntime` seam (`runtime.ts:68-78`); `applyWrite` calls `assertWriteNotKilled`, which **fails closed** if kill-switch state is unreadable (`kill-guarded-provider.ts:40-54`, `store.ts:138-145`). Kill switch is cluster-safe DB state across five scopes with org-qualified ACCOUNT keys so tenants cannot collide (`kill-switch.ts:30-47`). REST/MCP principals are `api_client`s that may preview but **never self-apply** (`runtime.ts:46-49,163-166`, `allowSelfApproval: false`). The dashboard apply route is default-OFF (`assertApplyAllowed()`), owner/admin-only, org-scoped lookup, and routes four-eyes through the one policy-engine seam (`approvals/[id]/apply/route.ts:19-31`). Tests assert fail-closed per scope and "no caller can bypass" including AI/service-account/stale-approval (`test/kill-switch-enforcement.database.test.ts:66,69,127`).
5. **Platform-admin plane & SoD.** Platform authority comes **only** from the `platform_operators` roster, never from org membership; a dedicated **SELECT-only** `adport_platform_admin` DB role serves cross-tenant reads so an admin read bug cannot mutate tenant data (`lib/platform/db.ts`, `20261014000000_platform_admin.sql:1-60`). Guards run server-side (`lib/platform/auth.ts:50-73`); `READ_ONLY_AUDITOR` cannot mutate. Segregation-of-duties invariants are hard-coded and enforced at write time, not only at quorum eval: requester≠approver, the AI/model can neither approve nor execute, a service account cannot satisfy a human approval (`rbac.ts:53-66`, re-checked in `store.ts:95-99`). Verified by `test/platform-admin-authz.database.test.ts` (tenant user cannot read roster/audit; org owner is not an operator; admin role cannot mutate).

---

## Dimension scores (0–5)

| Dimension | Score | Basis |
|---|---|---|
| Tenant isolation / IDOR | 4 | Consistent server-derived org predicate + parameterized SQL + membership re-validation + tests; single-layer (app), RLS not a backstop for tenant data (F-2). |
| OAuth security (provider + MCP: state/PKCE/redirect/token) | 5 | S256 PKCE, single-use bound state/codes, exact-match redirect allowlist, audience binding, rotation w/ replay detection, open-redirect-safe. |
| Credential / token / API-key storage | 5 | AES-256-GCM w/ tenant-bound AAD, HMAC-peppered keys, signed+DB-verified tokens, encrypted PKCE verifier. |
| Provider-write safety (Mode-B hold + kill switch) | 5 | Fail-closed guard on single apply seam, two-step, human four-eyes, default-off live writes, SoD, no-bypass tested. |
| Admin privilege escalation / impersonation | 5 | Separate authority plane, SELECT-only cross-tenant role, server guards, no org→platform escalation, tested. |
| Audit integrity (append-only) | 3 | Platform audit DB-enforced append-only & tested; tenant `audit_events`/`pending_operations` append-only by convention only (F-1). |
| Injection / CSRF / SSRF / webhook | 4 | Parameterized SQL throughout, Stripe webhook HMAC-verified (`billing/webhook/route.ts:9`), redirect/resource validation blocks SSRF-style abuse, prompt-injection neutered by human-in-loop; CSRF relies on SameSite+JSON (F-4). |

---

## Residual risks

- Tenant audit/pending history is mutable at the DB-role level (F-1); add a per-table `REVOKE UPDATE, DELETE` + deny-trigger to match the platform-audit bar.
- The entire tenant boundary is one app-layer predicate with no RLS backstop (F-2); any future `unsafe` query, DB-reachable SSRF, or backend-credential leak is cross-tenant total.
- Prompt injection can still steer *previews/recommendations* (bad proposals), though not autonomous writes — the human approval gate is the control, so UI must render model-proposed diffs clearly (out of scope here, flagged).
- E2E login route and CSRF posture depend on deployment hygiene (F-3, F-4).

---

## Verdict

**WOULD_USE_AS_SECONDARY_TOOL.**

The security-critical machinery — OAuth (both flows), credential encryption, kill switch, provider-write two-step with four-eyes and SoD, and the separated platform-admin plane — is genuinely well-built and, importantly, **enforced in code and proven by database-level tests**, not merely documented. The reason this is not an unqualified "daily/primary" verdict is the audit-integrity gap (F-1: tenant history is not DB-immutable) combined with the single-layer tenant-isolation design (F-2: no RLS backstop for tenant data). Those are defensible engineering choices, but for a product handling multi-tenant advertiser credentials and money-moving writes, tamper-evident audit and a second isolation layer are table stakes before it carries primary trust. Close F-1 (trivial: revoke + deny-trigger) and the case for a higher tier is strong.
