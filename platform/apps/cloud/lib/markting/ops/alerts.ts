import 'server-only';

/**
 * PHASE C.5 (4) — the CANONICAL ALERT pipeline (one pipeline, not one per subsystem).
 *
 * Pure model: given an incoming alert signal and the current stored instance for its dedup key, decide
 * the next instance state and whether to DELIVER now. Delivery itself is a separate channel port
 * (`alert-delivery.ts`); persistence is a store port (`alert-store.ts`). This enforces no-storms:
 * repeat signals within a cooldown bump the count + last_seen but do NOT re-deliver; a signal after the
 * cooldown (or after a RESOLVED) reopens and re-delivers.
 */

export const ALERT_TYPES = [
  'PROVIDER_OUTAGE', 'AUTH_FAILURE_SPIKE', 'REAUTH_SPIKE', 'SCHEMA_DRIFT', 'SYNC_BACKLOG',
  'STALE_DATA', 'WEBHOOK_FAILURE', 'AI_GATEWAY_FAILURE', 'AI_COST_ANOMALY', 'QUEUE_FAILURE',
  'SECURITY_INCIDENT',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertState = 'OPEN' | 'DELIVERED' | 'COOLDOWN' | 'RESOLVED';

/** Default severity per type (operator can override on the incident it feeds). */
export const ALERT_SEVERITY: Record<AlertType, AlertSeverity> = {
  SECURITY_INCIDENT: 'CRITICAL', PROVIDER_OUTAGE: 'CRITICAL', QUEUE_FAILURE: 'CRITICAL',
  AI_GATEWAY_FAILURE: 'WARNING', AUTH_FAILURE_SPIKE: 'WARNING', REAUTH_SPIKE: 'WARNING',
  SCHEMA_DRIFT: 'WARNING', SYNC_BACKLOG: 'WARNING', STALE_DATA: 'WARNING',
  WEBHOOK_FAILURE: 'WARNING', AI_COST_ANOMALY: 'WARNING',
};

export interface AlertInput {
  type: AlertType;
  source: string;                 // the subsystem that raised it
  organizationId?: string | null; // null for a platform-wide signal
  provider?: string | null;
  evidence?: Record<string, unknown>;
  severity?: AlertSeverity;       // override the default
}

export interface AlertRecord {
  id?: string;
  type: AlertType;
  severity: AlertSeverity;
  source: string;
  organizationId: string | null;
  provider: string | null;
  dedupKey: string;
  correlationId: string;
  state: AlertState;
  count: number;
  evidence: Record<string, unknown>;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  cooldownUntilMs: number | null;
  incidentId: string | null;
}

/** The dedup identity: type + org + provider + source. Same key collapses into one instance. */
export function dedupKey(input: Pick<AlertInput, 'type' | 'organizationId' | 'provider' | 'source'>): string {
  return [input.type, input.organizationId ?? '-', input.provider ?? '-', input.source].join('|');
}

export const DEFAULT_COOLDOWN_MS = 15 * 60_000;

export interface AlertDecision {
  record: AlertRecord;
  /** True when this signal should be delivered to channels now (new, or reopened after cooldown/resolve). */
  deliver: boolean;
}

/**
 * Fold an incoming signal into the stored instance. New key → OPEN + deliver. Repeat within cooldown →
 * COOLDOWN, count++, no deliver (anti-storm). Repeat after cooldown or after RESOLVED → reopen (OPEN) +
 * deliver, count++.
 */
export function ingestAlert(
  existing: AlertRecord | null,
  input: AlertInput,
  now: number,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
  newCorrelationId: () => string = defaultCorrelationId,
): AlertDecision {
  const severity = input.severity ?? ALERT_SEVERITY[input.type];
  const key = dedupKey(input);
  const evidence = input.evidence ?? {};

  if (!existing) {
    return {
      deliver: true,
      record: {
        type: input.type, severity, source: input.source,
        organizationId: input.organizationId ?? null, provider: input.provider ?? null,
        dedupKey: key, correlationId: newCorrelationId(), state: 'OPEN', count: 1,
        evidence, firstSeenAtMs: now, lastSeenAtMs: now, cooldownUntilMs: now + cooldownMs, incidentId: null,
      },
    };
  }

  const reopen = existing.state === 'RESOLVED' || (existing.cooldownUntilMs != null && now >= existing.cooldownUntilMs);
  return {
    deliver: reopen,
    record: {
      ...existing,
      severity, // severity can escalate on repeat
      count: existing.count + 1,
      evidence: { ...existing.evidence, ...evidence },
      lastSeenAtMs: now,
      state: reopen ? 'OPEN' : 'COOLDOWN',
      cooldownUntilMs: reopen ? now + cooldownMs : existing.cooldownUntilMs,
      // a reopen after RESOLVED starts a fresh correlation id
      correlationId: existing.state === 'RESOLVED' ? newCorrelationId() : existing.correlationId,
    },
  };
}

/** Mark delivered (channels ran). */
export function markDelivered(record: AlertRecord): AlertRecord {
  return { ...record, state: 'DELIVERED' };
}

/** Resolve an alert (operator or an auto-resolver). */
export function resolveAlert(record: AlertRecord): AlertRecord {
  return { ...record, state: 'RESOLVED', cooldownUntilMs: null };
}

function defaultCorrelationId(): string {
  return `alrt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
