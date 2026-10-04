import { deriveProviderHealth, type ProviderHealthState } from '@/lib/markting/ops/provider-health';
import type { ConnectionErrorClass, ConnectionHealthState, ConnectionStatus } from './vocabulary';

/**
 * CONNECTIONS CONTROL PLANE — deterministic status + health derivation.
 *
 * Canonical status/health are a PURE function of observable signals (stored row state + token expiry +
 * recent errors + scope gaps). No model, no network. Health reuses the existing, tested
 * deriveProviderHealth state machine so the fleet health vocabulary never diverges from the tenant one.
 * We never show a stale "connected": expiry, reauth flags and disabled state always win.
 */

export interface ConnectionSignals {
  /** Base row status in public.connections. */
  baseStatus?: 'connected' | 'error' | 'revoked';
  /** Operator-disabled connection. */
  disabled?: boolean;
  /** Tenant/operator flagged that reauthorization is required. */
  reauthRequired?: boolean;
  /** Whether a credential row exists at all. */
  hasCredential?: boolean;
  /** Whether the provider/integration is available for this org (rollout/config). */
  available?: boolean;
  /** ISO token expiry if known. */
  tokenExpiresAt?: string | null;
  /** Classified last error, if any. */
  errorClass?: ConnectionErrorClass | null;
  /** Count of required scopes NOT present in the granted set (if discoverable). */
  missingScopeCount?: number;
  /** Health-probe signals. */
  lastProbeOk?: boolean;
  lastProbeAt?: string | null;
  recentAuthFailures?: number;
  recentRateLimited?: boolean;
  recentErrorRate?: number;
  now?: number;
}

/** Derive the coarse fleet health state (reuses the tested provider-health machine). */
export function deriveConnectionHealth(s: ConnectionSignals): { state: ConnectionHealthState; reason: string } {
  const h = deriveProviderHealth({
    disabled: s.disabled,
    tokenExpiresAt: s.tokenExpiresAt ?? undefined,
    lastProbeOk: s.lastProbeOk,
    lastProbeAt: s.lastProbeAt ?? undefined,
    recentAuthFailures: s.recentAuthFailures,
    recentRateLimited: s.recentRateLimited,
    recentErrorRate: s.recentErrorRate,
    now: s.now,
  });
  return h as { state: ProviderHealthState; reason: string };
}

/**
 * Derive the canonical fine-grained connection status. Precedence (highest first):
 * not-configured → disabled → revoked/disconnected → expired → reauth-required → insufficient-permissions
 * → error-class-specific → rate-limited → degraded → connected.
 */
export function deriveConnectionStatus(s: ConnectionSignals): { status: ConnectionStatus; reason: string } {
  const now = s.now ?? Date.now();

  // No credential and nothing configured.
  if (!s.hasCredential && s.baseStatus === undefined) {
    return s.available === false
      ? { status: 'NOT_CONFIGURED', reason: 'integration not available for this organization' }
      : { status: 'NOT_CONFIGURED', reason: 'not connected' };
  }
  if (s.disabled) return { status: 'DISABLED', reason: 'disabled by a platform operator' };
  if (s.baseStatus === 'revoked') return { status: 'DISCONNECTED', reason: 'grant revoked' };

  // Expiry always wins over a stale "connected".
  if (s.tokenExpiresAt && now > Date.parse(s.tokenExpiresAt)) {
    return { status: 'EXPIRED', reason: 'OAuth token expired' };
  }
  if (s.reauthRequired) return { status: 'REAUTH_REQUIRED', reason: 'reauthorization requested' };
  if ((s.missingScopeCount ?? 0) > 0) return { status: 'INSUFFICIENT_PERMISSIONS', reason: `${s.missingScopeCount} required scope(s) missing` };

  // Classified error on the row.
  if (s.baseStatus === 'error' || (s.errorClass && s.errorClass !== 'UNKNOWN')) {
    switch (s.errorClass) {
      case 'TOKEN_EXPIRED':
        return { status: 'EXPIRED', reason: 'token expired' };
      case 'AUTH_ERROR':
        return { status: 'REAUTH_REQUIRED', reason: 'auth rejected — reauthorize' };
      case 'PERMISSION_ERROR':
        return { status: 'INSUFFICIENT_PERMISSIONS', reason: 'missing permission' };
      case 'RATE_LIMIT':
        return { status: 'RATE_LIMITED', reason: 'provider rate-limiting' };
      case 'SCHEMA_CHANGED':
        return { status: 'SCHEMA_CHANGED', reason: 'provider API shape changed' };
      case 'SYNC_ERROR':
        return { status: 'SYNC_FAILED', reason: 'sync run failed' };
      case 'ACCOUNT_DISABLED':
      case 'PROVIDER_5XX':
      case 'INVALID_REQUEST':
      case 'WEBHOOK_ERROR':
        return { status: 'PROVIDER_ERROR', reason: 'provider error' };
      default:
        return { status: 'PROVIDER_ERROR', reason: 'provider verification failed' };
    }
  }

  if (s.recentRateLimited) return { status: 'RATE_LIMITED', reason: 'provider rate-limiting' };
  if ((s.recentErrorRate ?? 0) >= 0.1 || (s.lastProbeAt && now - Date.parse(s.lastProbeAt) > 3_600_000)) {
    return { status: 'DEGRADED', reason: 'elevated error rate or stale probe' };
  }
  if (s.baseStatus === 'connected' || s.hasCredential) return { status: 'CONNECTED', reason: 'grant verified' };
  return { status: 'NOT_CONFIGURED', reason: 'not connected' };
}
