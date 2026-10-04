# 03 — Authentication & Credential Security

## Auth types supported honestly (not forced into one mechanism)
`oauth2`, `oauth2_pkce` (google, microsoft), `oauth1` (x, HMAC-SHA1 three-legged), `long_lived_token`
(meta, tiktok), `service_account` (apple ES256 JWT), `api_key`, `app_secret`, `merchant_credentials`
(salla/zid/woo/custom), `webhook_secret`. The canonical lifecycle is unified; the per-provider protocol is not.

## Credential storage (unchanged, audited strong)
- Single canonical crypto module `lib/crypto.ts`: AES-256-GCM with a random IV and **per-row AAD tenant
  binding** (`connection:<org>:<provider>`), versioned ciphertext; `digestApiKey` = peppered HMAC-SHA256;
  `safeEqual` constant-time; MCP access tokens HMAC-signed + DB-checked.
- All secrets live in the `private` schema (revoked from `anon`/`authenticated`) or in `public` tables guarded
  by BOTH a restrictive `using(false)` RLS policy AND an explicit revoke. Only the server's `adport_backend`
  role reads them. `adport_platform_admin` (the admin read role) has **no access** to `private.provider_credentials`
  (asserted in `connection-control-plane.database.test.ts`).

## No secret ever reaches the browser or an admin view
- `CanonicalConnection` has no token/secret field (asserted structurally in tests).
- The admin fleet/provider/connection read models select only non-secret metadata.
- Error text is sanitized by `describeProviderError` before display (no tokens, no raw upstream bodies).
- E2E asserts the admin integration DOM never contains `refresh_token/access_token/ciphertext/client_secret/bearer`.

## OAuth hygiene (unchanged)
Single-use hashed `state`, encrypted PKCE verifier, 10-min TTL, atomic `FOR UPDATE` consume, post-consent
re-authorization, duplicate-param rejection, fixed-origin redirect (no Host-header SSRF). PKCE S256 for
google/microsoft; others rely on state + confidential client secret (provider limitation, not a defect).

## Rotation / revocation / least privilege
- Reactive token refresh persisted via `rotateProviderTokens` (fails closed on concurrent change; rotates
  only token fields, never account scope).
- Disconnect revokes at the provider where supported, then deletes the `connections` row which **cascades**
  the encrypted credential out of the DB. Where no server-side revoke exists, the local grant is deleted and
  the UI tells the user to remove access manually.
- Operator **disable** fails closed: `loadProviderCredentials` skips `disabled_at is not null`, so a disabled
  connection is never loaded into the tenant runtime (no reads/writes).
- No proactive/scheduled refresh (reactive-on-use, by design).
