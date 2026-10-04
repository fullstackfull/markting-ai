# 10 — Connection E2E & DB/RLS Tests

## Browser E2E (`e2e/`)
- `journeys.spec.ts` E2E-12 (authed buyer, DEMO runtime): the tenant Connection Center renders canonical
  provider cards, an unconnected provider shows `NOT_CONFIGURED`, and no other org's name leaks.
- `admin.spec.ts`:
  - `@operator` reaches `/admin/integrations` (fleet overview + capability catalog), `/admin/integrations/google`
    (provider detail), `/admin/integrations/search?q=google`.
  - `@operator` secret check: the integration DOM never contains `refresh_token/access_token/ciphertext/
    client_secret/bearer`.
  - `@owner-denied`: a tenant owner cannot reach `/admin/integrations` (server guard → notFound; no admin chrome).
  - `@public`: unauthenticated cannot reach the admin plane.

## Pure domain unit tests (node lane) — `test/connections-domain.test.ts`
Vocabulary + remediation completeness; `classifyConnectionError` taxonomy (12 cases); status derivation
precedence (expired beats connected, disabled wins, reauth, missing-scopes, error-class mapping); registry
facts (refresh/revoke/serverDryRun/webhook/liveTransport); no provider claims scheduled refresh; contract
provenance records exist for every adapter and none is falsely LIVE_CAPTURED. 32 assertions, all green.

## Real-Postgres tests (cloud-db lane) — `test/connection-control-plane.database.test.ts`
- `connections` carries the canonical lifecycle columns.
- Canonical read returns all 11 ad providers with deterministic status and **no secret field** on the shape.
- `connection_events` is org-scoped (org B's events never leak into org A).
- `connection_events` is **append-only**: both `adport_backend` and `adport_platform_admin` are rejected on
  UPDATE/DELETE; `adport_platform_admin` is rejected on INSERT.
- `adport_platform_admin` has **no access** to `private.provider_credentials` (secrets unreachable by the admin role).

## What is NOT faked
Live provider OAuth and live commerce transport require real credentials that do not exist in CI, so those
paths are tested through documentation-derived/synthetic contracts and labelled BLOCKED_EXTERNAL — never a
fake "live" result.
