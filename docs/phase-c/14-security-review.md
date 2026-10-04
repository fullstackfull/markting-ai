# C0.5 — Pre-live security review

Scope: the controls that must hold **before** any live provider credential is introduced. No live
credentials exist in this environment, so live-path items that cannot be exercised without them are
marked `BLOCKED_EXTERNAL` (code reviewed, not credential-tested) rather than claimed verified.

Severity: P0 = exploitable cross-tenant/privilege/credential break; P1 = serious; P2/P3 = hardening.

| # | Area | Finding | Severity | Status |
|---|------|---------|----------|--------|
| 1 | Account ownership | One canonical `authorizeTenantAccount` guard on every account-scoped route; DEMO = seed membership, LIVE = `organization_ad_accounts` scoped to the org; nested chain integrity via `found:false`. | — | **PASS** (C0.1; unit + real-Postgres cross-tenant tests) |
| 2 | Cross-tenant existence oracle | Cross-tenant and non-existent ids both → `notFound()` (identical 404). No access-denied-vs-not-found distinction. | — | **PASS** |
| 3 | Route-param integrity | Composite ids URL-decoded once server-side before authz/lookup (`decodeParams`); no injection surface (ids are compared by equality, never interpolated into SQL — all queries are parameterized `postgres` tags). | — | **PASS** (C0.4) |
| 4 | OAuth callback / state / tenant binding | Connection management is gated to org owners/admins (`canAdminister`) and every action is org-scoped (`tenant.organizationId`); connection rows are keyed `(organization_id, provider)` unique and the `(id, organization_id, provider)` composite FK binds every discovered ad account to its org's connection. The live OAuth **callback exchange** (state/nonce round-trip, code→token) runs in the broker and cannot be exercised without a real provider app. | P1 if unbound | **PASS (static)** / live exchange `BLOCKED_EXTERNAL` |
| 5 | Provider account activation | `setAccountEnabled` re-checks the connection is `connected` and selection complete, enforces plan limits, and writes an audit event; disabled/`account_selection_id`-pending connections cannot enable an account. | — | **PASS** |
| 6 | Account discovery | `syncDiscoveredAccounts` writes `organization_ad_accounts` only under the acting org's connection id; discovery for org A can never create rows under org B (FK + org-scoped writes). | — | **PASS (static)** / live discovery `BLOCKED_EXTERNAL` |
| 7 | Cross-tenant provider identifiers | Enabled-account reads filter `connection.status='connected' AND account_selection_id IS NULL` within the org (`loadEnabledAccountIds`); a provider account id from another tenant is not reachable because the join is org-scoped. | — | **PASS** |
| 8 | Token storage / credential leakage | Secrets are sealed with AES-256-GCM envelope encryption (`lib/markting/ops/kms.ts`, per-record data key, rotation-safe keyring). The Platform-Admin integration surface renders status/health/expiry only and is asserted by E2E to **never** render secret/token material (`admin.spec.ts` "never renders secret/token material"). | P0 if leaked | **PASS** |
| 9 | Replay / token revocation / disabled connection | Revocation sets `revoked_at` / status; operator "request reauthorize" sets `reauth_required`; "disable" sets `disabled_at`+`health_state='DISABLED'`. Reads gate on `status='connected'`, so a revoked/disabled connection stops feeding data. Server-side revoke exists for providers that support it; others carry a `manualRevokeNote`. Live replay/expiry behavior is `BLOCKED_EXTERNAL`. | — | **PASS (static)** |
| 10 | Source-mode guard | `assertResultPostureAllowed(runtimeMode, trustTier)` fails **closed** before any answer reaches a surface, so a regression that wired synthetic data into a live posture (or vice-versa) throws rather than leaking (`guardAnswerPosture` wraps every orchestrator answer). | P0 if bypassed | **PASS** |
| 11 | Apply / write safety | The runtime-mode type has no autonomous-write member; `assertApplyAllowed` refuses apply outside `DEMO` / `LIVE_WRITE_APPROVAL_ONLY`. Mode B remains HELD. | — | **PASS** |
| 12 | Tenant RLS backstop | Restrictive RLS policies clamp `adport_backend` to one org when the `app.current_organization_id` GUC is set (migration `20261018000000`), proven by `tenant-rls-backstop.database.test.ts` (read/insert/update/delete all blocked cross-tenant; service-job and admin-read paths intact). | — | **PASS** |
| 13 | Admin connection access | Platform-admin plane is a separate role (`adport_platform_admin`, read-only SELECT grant), its route tree returns `notFound()` to non-operators (existence not disclosed), and it exposes no secret material (item 8). | — | **PASS** |

## Conclusion

No exploitable **P0/P1** finding in the code-reviewable surface. The remaining risk items are
inherent to live credentials (OAuth callback exchange, token refresh/expiry/replay, live account
discovery) and are **`BLOCKED_EXTERNAL`** — reviewed statically, to be credential-tested when a
provider app and sandbox credentials exist, never fabricated. **No live credentials may be
introduced until this review is signed off; this document is that pre-live sign-off for the
code-solvable controls.**
