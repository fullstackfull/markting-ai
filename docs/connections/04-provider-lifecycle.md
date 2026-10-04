# 04 — Paid-Media Provider Lifecycle

All 11 ad adapters are live HTTP clients; lifecycle control lives in the OAuth broker
(`lib/cloud/provider-oauth*.ts`) + canonical domain (`lib/connections/*`).

## Connect (wizard)
Tenant Connection Center → **Connect** opens the consistent wizard: select → explain → **permissions
requested** (from `oauthAdapter(provider).scopes`) → authenticate (hosted OAuth popup) → discover accounts →
select accounts → validate → finish. **Never shows success before validation** — the grant is verified and
accounts are listed before anything is activated; OAuth consent alone never activates accounts.

## Authenticate / callback
`/api/oauth/[provider]/start` (role-gated, PKCE verifier, single-use state) → provider consent →
`/api/oauth/[provider]/callback` consumes the transaction atomically, exchanges the code, stores the encrypted
grant, verifies via `listAccounts()`, and **stages account selection**. On connect the canonical columns
(`auth_type`, `last_authenticated_at`, `health_state=CONNECTED`, `reauth_required=false`) are populated.

## Test connection
Tenant **Test connection** (`lib/connections/tenant-actions.ts#testConnection`) performs a REAL probe
(`runtime.ctx.providers.get(provider).listAccounts()`) when a credential exists; on success it sets
`status=connected` + records a `test_connection` event; on failure it classifies the error deterministically,
stores the class + sanitized message, and records the failure. With no credential it reports NOT_CONFIGURED
(never a fake success).

## Reauthorize
Re-running connect reuses the connection id (`credential-rotation.ts`), refreshes `last_authenticated_at` and
clears `reauth_required`. An operator can set `reauth_required` (tenant sees a banner).

## Refresh
In-adapter reactive refresh for google/microsoft/reddit/apple/snapchat/spotify/pinterest/linkedin; **not**
for meta/tiktok (long-lived) or x (OAuth1) — the registry hides the Refresh control for those.

## Disconnect / revoke
Server-side revoke for google/meta/tiktok/reddit/x; manual-removal note for the rest. Disconnect cascades the
encrypted credential out of the DB regardless. All lifecycle transitions are recorded in `connection_events`
and (for tenant) `audit_events`.

## Account discovery & scope intelligence
`discoverAccounts` re-lists accounts and refreshes the inventory (no silent activation). Missing scopes are
computed as `required − granted` and shown as INSUFFICIENT_PERMISSIONS, but only drive status for providers
with `permissionDiscovery: 'full'` (so an informational scope list never produces a false permission error).
