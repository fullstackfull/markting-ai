/**
 * CONNECTIONS CONTROL PLANE — canonical vocabulary.
 *
 * ONE status vocabulary, ONE error taxonomy, ONE auth-type set shared by the tenant Connection Center
 * and the Super Admin Integration Operations Center. Providers never invent unrelated semantics. All of
 * this is deterministic data — no model ever decides a connection's status, health, or error class.
 *
 * This module is pure (no DB, no secrets, no server-only) so it can be imported by client components,
 * server components, server actions and tests alike.
 */

/** Canonical connection status. A connection is always in exactly one of these. */
export const CONNECTION_STATUSES = [
  'CONNECTED',
  'DEGRADED',
  'REAUTH_REQUIRED',
  'EXPIRED',
  'INSUFFICIENT_PERMISSIONS',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'SCHEMA_CHANGED',
  'SYNC_FAILED',
  'DISCONNECTED',
  'NOT_CONFIGURED',
  'DISABLED',
  'BLOCKED_EXTERNAL',
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** Whether a status is a healthy/operational one (green), a warning (amber), or a failure (red). */
export function statusTone(status: ConnectionStatus): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (status) {
    case 'CONNECTED':
      return 'ok';
    case 'DEGRADED':
    case 'RATE_LIMITED':
    case 'REAUTH_REQUIRED':
    case 'SYNC_FAILED':
      return 'warn';
    case 'EXPIRED':
    case 'INSUFFICIENT_PERMISSIONS':
    case 'PROVIDER_ERROR':
    case 'SCHEMA_CHANGED':
    case 'DISABLED':
      return 'bad';
    case 'NOT_CONFIGURED':
    case 'DISCONNECTED':
    case 'BLOCKED_EXTERNAL':
      return 'neutral';
  }
}

/** Does the status mean the connection can currently serve reads/writes? */
export function statusIsOperational(status: ConnectionStatus): boolean {
  return status === 'CONNECTED' || status === 'DEGRADED' || status === 'RATE_LIMITED';
}

/**
 * Canonical connection ERROR taxonomy. Every provider/connection failure is classified into exactly one
 * of these so that remediation is deterministic rather than a free-text guess.
 */
export const CONNECTION_ERROR_CLASSES = [
  'AUTH_ERROR',
  'PERMISSION_ERROR',
  'TOKEN_EXPIRED',
  'RATE_LIMIT',
  'NETWORK_ERROR',
  'PROVIDER_5XX',
  'INVALID_REQUEST',
  'SCHEMA_CHANGED',
  'UNSUPPORTED_CAPABILITY',
  'ACCOUNT_DISABLED',
  'WEBHOOK_ERROR',
  'SYNC_ERROR',
  'UNKNOWN',
] as const;
export type ConnectionErrorClass = (typeof CONNECTION_ERROR_CLASSES)[number];

/** Deterministic recommended action for each error class. The UI renders this verbatim. */
export const ERROR_REMEDIATION: Record<ConnectionErrorClass, { action: string; detail: string }> = {
  AUTH_ERROR: { action: 'Reauthorize', detail: 'The stored grant is invalid or revoked. Reauthorize the connection.' },
  PERMISSION_ERROR: { action: 'Review required permissions', detail: 'The grant is missing a required permission/scope. Reconnect and approve all requested permissions.' },
  TOKEN_EXPIRED: { action: 'Reauthorize', detail: 'The access/refresh token has expired. Reauthorize to mint a fresh grant.' },
  RATE_LIMIT: { action: 'Retry later', detail: 'The provider is rate-limiting requests. Back off and retry on a schedule; no reconnect needed.' },
  NETWORK_ERROR: { action: 'Retry', detail: 'A transient network error reaching the provider. Retry in a moment.' },
  PROVIDER_5XX: { action: 'Retry later', detail: 'The provider returned a server error. Retry later; if it persists it is a provider-side incident.' },
  INVALID_REQUEST: { action: 'Engineering review', detail: 'The request was rejected as malformed. This is an app/provider compatibility issue, not a tenant action.' },
  SCHEMA_CHANGED: { action: 'Engineering / provider compatibility incident', detail: 'The provider changed its API shape. Open a provider-compatibility incident; a reconnect will not fix it.' },
  UNSUPPORTED_CAPABILITY: { action: 'No action', detail: 'This capability is not supported for this provider. The control should not be offered.' },
  ACCOUNT_DISABLED: { action: 'Check account at provider', detail: "The external account is disabled or suspended at the provider. Resolve it in the provider's console." },
  WEBHOOK_ERROR: { action: 'Review webhook configuration', detail: 'Webhook delivery or signature verification failed. Re-verify the endpoint and signing secret.' },
  SYNC_ERROR: { action: 'Retry sync', detail: 'A data sync run failed. Retry the sync; repeated failures are a data-quality incident.' },
  UNKNOWN: { action: 'Retry', detail: 'The failure could not be classified. Retry; if it persists, escalate with the server-side error detail.' },
};

/**
 * Canonical health (a coarser roll-up of status used for fleet dashboards). Mirrors the existing
 * deterministic provider-health state machine (lib/markting/ops/provider-health.ts) so the two never
 * diverge; this is the shared control-plane vocabulary.
 */
export const CONNECTION_HEALTH_STATES = ['CONNECTED', 'DEGRADED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'ERROR', 'DISABLED'] as const;
export type ConnectionHealthState = (typeof CONNECTION_HEALTH_STATES)[number];

export function healthTone(state: ConnectionHealthState): 'ok' | 'warn' | 'bad' {
  if (state === 'CONNECTED') return 'ok';
  if (state === 'DEGRADED' || state === 'RATE_LIMITED') return 'warn';
  return 'bad';
}

/** Canonical authentication mechanisms. Lifecycle is canonical; the protocol per provider is NOT forced. */
export const AUTH_TYPES = [
  'oauth2',
  'oauth2_pkce',
  'oauth1',
  'long_lived_token',
  'short_lived_token',
  'api_key',
  'app_secret',
  'service_account',
  'webhook_secret',
  'merchant_credentials',
] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

/** Connection categories — paid media, commerce, and platform services all use the same domain. */
export const CONNECTION_CATEGORIES = ['paid_media', 'commerce', 'platform_service'] as const;
export type ConnectionCategory = (typeof CONNECTION_CATEGORIES)[number];

/** Canonical connection lifecycle events (append-only connection audit trail). */
export const CONNECTION_EVENTS = [
  'connected',
  'reauthorized',
  'account_selected',
  'scopes_changed',
  'credential_rotated',
  'disconnected',
  'revoked',
  'sync_triggered',
  'sync_succeeded',
  'sync_failed',
  'webhook_changed',
  'health_recheck',
  'reauth_requested',
  'disabled',
  'enabled',
  'test_connection',
] as const;
export type ConnectionEvent = (typeof CONNECTION_EVENTS)[number];
