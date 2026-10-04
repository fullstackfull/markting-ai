# 11 — Connection Security Review

Posture after the Connections Control Plane, with enforcement evidence (not documentation-only claims).

## Secrets
- One canonical crypto module (AES-256-GCM + per-row AAD tenant binding, peppered HMAC, constant-time). No
  second crypto system introduced.
- Secrets live only in `private.provider_credentials` / guarded `public` tables; `adport_platform_admin` has
  no grant on `private.provider_credentials` (test-enforced).
- The canonical `CanonicalConnection` type and all admin read models have **no secret field** (structural
  test). E2E asserts no token/secret strings in the admin DOM. Error text is sanitized.

## Tenant isolation
- Tenant reads are org-scoped in SQL under `adport_backend`. `connection_events` adds a member RLS policy
  (own-org only) and an org-scoped query path (test: org B never leaks into org A).
- Cross-tenant admin reads run ONLY through the SELECT-only `adport_platform_admin` role — physically cannot
  mutate tenant data.

## Authorization
- Tenant actions are owner/admin-only, tenant-scoped, audited.
- Platform actions are platform-role-gated (READ_ONLY_AUDITOR rejected), reason-required, written to the
  append-only `platform_admin_audit` + `connection_events`. Disable requires SUPER_ADMIN/PLATFORM_OPERATOR.
- Platform RBAC remains entirely separate from tenant RBAC (authority only from `platform_operators`).

## Dangerous-action restraint
- No plaintext credential/token replacement UI exists anywhere. The strongest admin action is **disable**
  (fails closed) or **request reauthorization**. "Force health recheck" is a deterministic recompute, not a
  live probe (operators never hold tenant credentials).

## Phase-0 invariants intact
No autonomous optimization enabled; Mode-B provider writes HELD (this program adds no runtime write mode); the
kill switch and `KillGuardedProvider` are unchanged; `engine/` byte-identical. Disabled connections fail closed
at credential load, reinforcing the write-safety posture.

## Webhook/SSRF
Commerce webhook verifier uses HMAC + server-derived tenant + replay window + dedup (route not mounted yet).
OAuth redirects are fixed-origin (no Host-header SSRF). Signing secrets stored as opaque refs, never values.

## Residual (not defects)
PKCE is not universal across ad providers (provider limitation); MCP revocation is token-type-specific
(RFC7009); no proactive token refresh (reactive by design).
