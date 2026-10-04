import type { ConnectionLifecycleState } from './connection-state-machine';

/**
 * PHASE C.6 (15) — PROVIDER-NEUTRAL TOKEN REFRESH ENGINE.
 *
 * Owns the OAuth token lifecycle AROUND a provider's refresh endpoint, with no live OAuth of its own: a
 * `TokenRefresher` port is injected (a FAKE in tests; a real HTTP refresh only where credentials exist —
 * BLOCKED_EXTERNAL). The engine provides:
 *   - expiry detection with a configurable skew window (treat a token expiring within the window as due);
 *   - a refresh-needed decision (expired/near-expiry AND refreshable AND not revoked);
 *   - a SINGLE-FLIGHT refresh lock so N concurrent callers share ONE in-flight refresh and never stampede
 *     the provider;
 *   - refresh-failure → REAUTH_REQUIRED, with a cooldown so a failing refresh is not hammered;
 *   - revocation handling (a revoked grant is never refreshed — it needs reauthorization).
 * Pure/async over the injected refresher + clock; deterministic (clock injectable). No secrets logged.
 */

/** Provider-neutral token state. Times are epoch milliseconds. */
export interface TokenState {
  accessToken?: string | null;
  /** Epoch ms when the access token expires. Absent/null ⇒ treated as already expired. */
  expiresAt?: number | null;
  /** Present ⇒ the grant is refreshable without user interaction. */
  refreshToken?: string | null;
  /** The grant was revoked (by provider or operator). A revoked grant is never refreshed. */
  revoked?: boolean;
}

/** What a successful refresh returns. */
export interface RefreshResult {
  accessToken: string;
  expiresAt: number;
  /** Providers that rotate refresh tokens return the new one; otherwise the old one is kept. */
  refreshToken?: string;
}

/** The injected refresh port. FAKE in tests; a real HTTP refresh is BLOCKED_EXTERNAL (needs credentials). */
export type TokenRefresher = (state: TokenState) => Promise<RefreshResult>;

/** The refresher throws this to signal the grant is gone — reauthorization, not retry. */
export class TokenRevokedError extends Error {
  constructor(message = 'token grant revoked') {
    super(message);
    this.name = 'TokenRevokedError';
  }
}

export interface TokenRefreshConfig {
  refresher: TokenRefresher;
  /** Treat a token expiring within this many ms as due for refresh. Default 60_000. */
  skewMs?: number;
  /** After a failed refresh, suppress further attempts for this many ms. Default 30_000. */
  cooldownMs?: number;
  /** Injectable clock (epoch ms). Default Date.now. */
  now?: () => number;
}

export type RefreshStatus =
  | 'FRESH'            // token still valid beyond the skew window — nothing to do
  | 'REFRESHED'        // a refresh ran (or was shared) and produced a new token
  | 'REAUTH_REQUIRED'  // cannot refresh (no refresh token, or refresh failed/revoked)
  | 'COOLDOWN';        // a recent failure is cooling down; caller should wait, not retry now

export interface RefreshOutcome {
  status: RefreshStatus;
  /** The token state after the attempt (unchanged on FRESH/COOLDOWN/REAUTH without mutation). */
  state: TokenState;
  reason: string;
  /** The lifecycle state this outcome maps to (ties to the connection state machine). */
  nextConnectionState: ConnectionLifecycleState;
}

/** True when the token is expired or within `skewMs` of expiry at `now`. Absent expiry ⇒ expired. */
export function isTokenExpired(state: TokenState, now: number, skewMs: number): boolean {
  if (state.expiresAt == null) return true;
  return now + skewMs >= state.expiresAt;
}

/** True when a refresh should be attempted: not revoked, refreshable, and expired/near-expiry. */
export function isRefreshNeeded(state: TokenState, now: number, skewMs: number): boolean {
  if (state.revoked) return false;
  if (!state.refreshToken) return false;
  return isTokenExpired(state, now, skewMs);
}

const DEFAULT_SKEW_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * Stateful token-refresh engine for a single connection/grant. Concurrent `ensureFresh` callers that both
 * trigger a refresh share the SAME in-flight promise (single-flight), so the provider is called exactly
 * once per refresh cycle. A failure opens a cooldown window; a revoked grant short-circuits to reauth.
 */
export class TokenRefreshEngine {
  private readonly refresher: TokenRefresher;
  private readonly skewMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  /** The shared in-flight refresh, if one is running (single-flight lock). */
  private inflight: Promise<RefreshOutcome> | null = null;
  /** Epoch ms until which refresh attempts are suppressed after a failure. */
  private cooldownUntil = 0;

  constructor(config: TokenRefreshConfig) {
    this.refresher = config.refresher;
    this.skewMs = config.skewMs ?? DEFAULT_SKEW_MS;
    this.cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = config.now ?? Date.now;
  }

  /** Whether a failure cooldown is currently active. */
  inCooldown(): boolean {
    return this.now() < this.cooldownUntil;
  }

  /**
   * Ensure the token is fresh, refreshing if due. Safe to call concurrently: simultaneous callers that
   * trigger a refresh await one shared refresh and all receive its outcome.
   */
  ensureFresh(state: TokenState): Promise<RefreshOutcome> {
    const now = this.now();

    // A revoked grant is never refreshed — it needs reauthorization.
    if (state.revoked) {
      return Promise.resolve(reauth(state, 'grant is revoked — reauthorization required'));
    }
    // Still comfortably valid.
    if (!isTokenExpired(state, now, this.skewMs)) {
      return Promise.resolve({ status: 'FRESH', state, reason: 'token valid beyond skew window', nextConnectionState: 'CONNECTED' });
    }
    // Expired/near-expiry but not refreshable → reauthorize.
    if (!state.refreshToken) {
      return Promise.resolve(reauth(state, 'token expired and no refresh token available'));
    }
    // A recent failure is cooling down — do not stampede the provider.
    if (this.inCooldown()) {
      return Promise.resolve({ status: 'COOLDOWN', state, reason: 'refresh is cooling down after a recent failure', nextConnectionState: 'EXPIRED' });
    }
    // Single-flight: join the in-flight refresh if one is already running.
    if (this.inflight) return this.inflight;

    this.inflight = this.runRefresh(state).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runRefresh(state: TokenState): Promise<RefreshOutcome> {
    try {
      const result = await this.refresher(state);
      this.cooldownUntil = 0; // success clears any cooldown
      const next: TokenState = {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
        refreshToken: result.refreshToken ?? state.refreshToken,
        revoked: false,
      };
      return { status: 'REFRESHED', state: next, reason: 'token refreshed', nextConnectionState: 'CONNECTED' };
    } catch (error) {
      // A revoked grant cannot be recovered by retry — go straight to reauth, no cooldown needed.
      if (error instanceof TokenRevokedError) {
        return reauth({ ...state, revoked: true }, 'provider reports the grant was revoked');
      }
      // Any other failure opens a cooldown window and requires reauthorization until it succeeds.
      this.cooldownUntil = this.now() + this.cooldownMs;
      return reauth(state, 'token refresh failed — reauthorization required');
    }
  }
}

function reauth(state: TokenState, reason: string): RefreshOutcome {
  return { status: 'REAUTH_REQUIRED', state, reason, nextConnectionState: 'REAUTH_REQUIRED' };
}
