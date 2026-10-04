# 02 — Canonical Connection Domain Model

One domain, two surfaces (tenant Connection Center + Super Admin Integration Center). We **evolved the
existing `public.connections`** rather than creating a second connection engine.

## Canonical table: `public.connections`
Migration `20261016000000_connection_control_plane.sql` added (all non-secret, nullable/defaulted):
`connection_type`, `environment`, `auth_type`, `scopes_required`, `token_expires_at`, `last_authenticated_at`,
`last_sync_at`, `last_webhook_at`, `error_classification`, `health_state`, `updated_by`, `reauth_required`,
`disabled_at`, `disabled_by`, `disabled_reason`. Pre-existing: `id, organization_id, provider, status,
external_subject/label, scopes, connected_by/at, last_verified_at, last_error, revoked_at, account_selection_id`.

Secrets stay in `private.provider_credentials` (AES-GCM, keyed by connection_id). The canonical read model
never selects them.

## Canonical read model (`lib/connections/read.ts` → `CanonicalConnection`)
Unifies paid-media (`connections` + `organization_ad_accounts`) and commerce (`markting_store_connections` +
`markting_commerce_sync_state`) into one shape with: id, provider, label, category, connectionType, status,
statusReason, health, authType, environment, available, liveTransportImplemented, accounts total/enabled,
accountSelectionId, scopesGranted/Required/missing, token expiry, last auth/verified/sync/webhook, lastError,
errorClass + remediation, reauthRequired, disabled, connectedAt, capabilities. **No secret fields exist on the type.**

## Status vocabulary (`lib/connections/vocabulary.ts`)
`CONNECTED, DEGRADED, REAUTH_REQUIRED, EXPIRED, INSUFFICIENT_PERMISSIONS, RATE_LIMITED, PROVIDER_ERROR,
SCHEMA_CHANGED, SYNC_FAILED, DISCONNECTED, NOT_CONFIGURED, DISABLED, BLOCKED_EXTERNAL`. One vocabulary; providers
never invent their own.

## Health (`CONNECTION_HEALTH_STATES`)
`CONNECTED, DEGRADED, AUTH_EXPIRED, RATE_LIMITED, ERROR, DISABLED` — reuses the tested `deriveProviderHealth`
state machine so tenant and fleet health never diverge. **Deterministic — never an LLM.**

## Error taxonomy (`CONNECTION_ERROR_CLASSES`)
`AUTH_ERROR, PERMISSION_ERROR, TOKEN_EXPIRED, RATE_LIMIT, NETWORK_ERROR, PROVIDER_5XX, INVALID_REQUEST,
SCHEMA_CHANGED, UNSUPPORTED_CAPABILITY, ACCOUNT_DISABLED, WEBHOOK_ERROR, SYNC_ERROR, UNKNOWN` — each with a
deterministic remediation (`ERROR_REMEDIATION`). `classify.ts` maps any raw error → class + action.

## Status derivation precedence (`status.ts`)
not-configured → disabled → revoked → **expired (always beats stale "connected")** → reauth-required →
insufficient-permissions → error-class-specific → rate-limited → degraded → connected.

## Append-only audit: `public.connection_events`
Lifecycle trail (connected/reauthorized/disconnected/revoked/sync/health_recheck/disabled/reauth_requested/…),
backend SELECT+INSERT only (no UPDATE/DELETE), member-readable per org, SELECT-only for `adport_platform_admin`.
No secret material ever written.
