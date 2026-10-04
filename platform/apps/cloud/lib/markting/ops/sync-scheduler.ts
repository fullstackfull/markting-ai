import 'server-only';
import type { SyncType } from './sync-runner';
import type { FreshnessTier } from './freshness';

/**
 * PHASE C.5 (2) — SCHEDULED SYNC.
 *
 * Decides WHEN a connection is due for its next poll, per provider cadence. It deliberately does NOT
 * treat every provider as near-real-time: ad providers have no push and are polled on a provider-tuned
 * cadence; commerce is webhook-first (polled only as a safety-net backstop). Pure: given the last
 * successful sync time and the clock, it reports whether a poll is due and which sync type to enqueue.
 */

export interface ProviderCadence {
  /** Expected freshness tier this cadence targets (couples to C9 freshness). */
  tier: FreshnessTier;
  /** Minimum minutes between INCREMENTAL polls. */
  incrementalMinutes: number;
  /** Whether this provider supports polling at all (false → event/webhook only). */
  pollable: boolean;
}

/** Provider cadences grounded in how each source actually delivers data (see docs/phase-c/10). */
export const PROVIDER_CADENCE: Record<string, ProviderCadence> = {
  meta: { tier: 'HOURLY', incrementalMinutes: 60, pollable: true },
  google: { tier: 'HOURLY', incrementalMinutes: 60, pollable: true },
  tiktok: { tier: 'HOURLY', incrementalMinutes: 90, pollable: true },
  snapchat: { tier: 'HOURLY', incrementalMinutes: 120, pollable: true },
  // Commerce is webhook-first; polling is only a daily safety-net backstop.
  shopify: { tier: 'DAILY', incrementalMinutes: 24 * 60, pollable: true },
  woocommerce: { tier: 'DAILY', incrementalMinutes: 24 * 60, pollable: true },
  salla: { tier: 'DAILY', incrementalMinutes: 24 * 60, pollable: true },
  zid: { tier: 'DAILY', incrementalMinutes: 24 * 60, pollable: true },
};

export interface ConnectionSyncState {
  organizationId: string;
  provider: string;
  /** null when the connection has never synced (→ INITIAL_SYNC is due). */
  lastSuccessfulSyncAtMs: number | null;
  /** The provider flagged the token as needing reauthorization. */
  reauthRequired?: boolean;
  /** A manual retry was requested by an operator/user. */
  manualRetryRequested?: boolean;
  connected: boolean;
}

export type ScheduleDecision =
  | { due: true; syncType: SyncType; reason: string }
  | { due: false; reason: string };

/**
 * Decide the next sync for one connection. Precedence: a disconnected connection is never scheduled; a
 * reauth flag wins (REAUTH_REQUIRED); a manual retry next (MANUAL_RETRY); a never-synced connection is
 * INITIAL; otherwise INCREMENTAL once the provider cadence has elapsed. Webhook-triggered syncs are
 * enqueued by the webhook ingress path, not here.
 */
export function decideSchedule(state: ConnectionSyncState, now: number): ScheduleDecision {
  if (!state.connected) return { due: false, reason: 'CONNECTION_NOT_CONNECTED' };
  const cadence = PROVIDER_CADENCE[state.provider];
  if (!cadence || !cadence.pollable) return { due: false, reason: 'PROVIDER_NOT_POLLABLE' };

  if (state.reauthRequired) return { due: true, syncType: 'REAUTH_REQUIRED', reason: 'REAUTH_FLAGGED' };
  if (state.manualRetryRequested) return { due: true, syncType: 'MANUAL_RETRY', reason: 'MANUAL_RETRY_REQUESTED' };
  if (state.lastSuccessfulSyncAtMs == null) return { due: true, syncType: 'INITIAL', reason: 'NEVER_SYNCED' };

  const elapsedMin = (now - state.lastSuccessfulSyncAtMs) / 60_000;
  if (elapsedMin >= cadence.incrementalMinutes) {
    return { due: true, syncType: 'INCREMENTAL', reason: `CADENCE_ELAPSED_${Math.round(elapsedMin)}m` };
  }
  return { due: false, reason: `WITHIN_CADENCE_${Math.round(elapsedMin)}m_of_${cadence.incrementalMinutes}m` };
}

/** The default priority for a scheduled job's sync type (mirrors SYNC_TYPE_PRIORITY). */
export function scheduleAll(states: ConnectionSyncState[], now: number): Array<{ state: ConnectionSyncState; decision: Extract<ScheduleDecision, { due: true }> }> {
  const out: Array<{ state: ConnectionSyncState; decision: Extract<ScheduleDecision, { due: true }> }> = [];
  for (const state of states) {
    const d = decideSchedule(state, now);
    if (d.due) out.push({ state, decision: d });
  }
  return out;
}
