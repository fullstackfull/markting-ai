# 00 — Connection Discovery (code-grounded)

Scope: a complete, read-the-actual-code audit of every integration in `fullstackfull/markting-ai` before
building the Connections & Integrations Control Plane. Nothing below is inferred from filenames.

## Integrations actually present
- **11 paid-media providers** (`platform/packages/{google,meta,tiktok,microsoft,reddit,apple,snapchat,spotify,pinterest,linkedin,x}`). Every one is a **real, live HTTP adapter** calling the provider's production API with real auth, real reads and writes — none is a fixture/stub. They are dormant only for lack of tenant credentials in this environment.
- **5 commerce connectors** (`salla, zid, shopify, woocommerce, custom`) in `lib/markting/commerce`. Adapters + incremental-sync engine + HMAC webhook verifier + schema are built and unit-tested, but there is **no live HTTP transport, no ingress route, no connection-creation path outside tests** → live transport is BLOCKED_EXTERNAL.
- **Platform services**: Stripe (live-capable, env-gated), Supabase/GoTrue (live), MCP OAuth 2.1 server (live), Resend email (env-gated). **AI gateway is DORMANT** (deterministic narrator; no live model).

## Two shared contracts (no single capability surface existed)
- Data plane: `packages/core/src/provider.ts` `interface AdProvider` (only declared capability flag was `serverDryRun`).
- Control plane: `lib/cloud/provider-oauth.ts` `interface OAuthAdapter<P>` (`authorizationUrl/exchange/revoke/scopes/pkce`).
- **Gap closed by this program**: `lib/connections/registry.ts` is now the single machine-readable capability + auth-type registry spanning account-discovery, scopes, refresh, revoke, webhook, sync.

## Connection tables found
- `public.connections` — canonical tenant connection (one row per org+provider). Previously thin (3 statuses, no health/error-class/expiry/lifecycle).
- `private.provider_credentials` — AES-GCM encrypted grant, keyed by connection_id (secrets never in `public`).
- `private.oauth_transactions`, `private.provider_account_selections` — short-lived handshake + account-pick state.
- `public.organization_ad_accounts` — discovered accounts under a connection.
- `public.markting_store_connections` + `markting_commerce_sync_state` + `markting_commerce_events` — commerce model.
- `public.markting_provider_health` — deterministic health state (was dead code at runtime).
- `private.mcp_oauth_*` — MCP server's own OAuth (unrelated to provider connections).

## Key findings that shaped the build
1. Canonical table is `public.connections`; it was evolved (not duplicated).
2. A deterministic `deriveProviderHealth` existed but was never written at runtime — now reused by the canonical status/health derivation.
3. No canonical error taxonomy — only a regex remediation mapper. Now there is one (`lib/connections/vocabulary.ts` + `classify.ts`).
4. Credential security is strong: one canonical crypto module (AES-256-GCM + per-row AAD tenant binding, peppered HMAC, constant-time), all secrets backend-only, no browser leaks, real revoke-via-cascade.
5. No background sync/worker runner exists (only 3 DB-hygiene pg_cron jobs) → sync "retry" is BLOCKED_EXTERNAL.
