/**
 * Phase 7X — PROVIDER CONNECTION HEALTH. Never surface a stale "connected" when credentials are broken.
 * Health is derived deterministically from the last probe + token expiry + recent error signals.
 */
export const PROVIDER_HEALTH_STATES = ['CONNECTED', 'DEGRADED', 'AUTH_EXPIRED', 'RATE_LIMITED', 'ERROR', 'DISABLED'] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

export interface HealthSignals {
  disabled?: boolean;
  tokenExpiresAt?: string;
  lastProbeOk?: boolean;
  lastProbeAt?: string;
  recentAuthFailures?: number;
  recentRateLimited?: boolean;
  recentErrorRate?: number;      // 0..1 over the recent window
  now?: number;
}

export function deriveProviderHealth(s: HealthSignals): { state: ProviderHealthState; reason: string } {
  const now = s.now ?? Date.now();
  if (s.disabled) return { state: 'DISABLED', reason: 'connection disabled by an operator' };
  if (s.tokenExpiresAt && now > Date.parse(s.tokenExpiresAt)) return { state: 'AUTH_EXPIRED', reason: 'OAuth token expired' };
  if ((s.recentAuthFailures ?? 0) >= 3) return { state: 'AUTH_EXPIRED', reason: 'repeated auth failures' };
  if (s.recentRateLimited) return { state: 'RATE_LIMITED', reason: 'provider is rate-limiting requests' };
  if (s.lastProbeOk === false || (s.recentErrorRate ?? 0) >= 0.5) return { state: 'ERROR', reason: 'last probe failed or high error rate' };
  if ((s.recentErrorRate ?? 0) >= 0.1) return { state: 'DEGRADED', reason: 'elevated error rate' };
  // Stale probe (> 1h) is DEGRADED, not CONNECTED — never show stale "connected".
  if (s.lastProbeAt && now - Date.parse(s.lastProbeAt) > 3_600_000) return { state: 'DEGRADED', reason: 'health probe is stale (> 1h)' };
  if (s.lastProbeOk) return { state: 'CONNECTED', reason: 'last probe ok' };
  return { state: 'DEGRADED', reason: 'no recent successful probe' };
}

/** Whether writes should be allowed given health (CONNECTED/DEGRADED allow; others block new writes). */
export function healthAllowsWrite(state: ProviderHealthState): boolean {
  return state === 'CONNECTED' || state === 'DEGRADED';
}
