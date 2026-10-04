import 'server-only';

/**
 * Phase C.5 (7) — COMPONENT HEALTH STATES.
 *
 * A single, honest health vocabulary for the operator-facing health endpoint. `computeHealth` is a
 * PURE function over injected probe signals + a small threshold set — it does no I/O itself, so the
 * route stays in charge of running (and wrapping) the real probes.
 *
 * It is OPERATOR-SAFE by construction: a component only ever reports a state + a terse reason CODE.
 * No connection string, hostname, version, stack trace, or any other infra detail is modelled, so it
 * cannot leak one. It also FAILS HONEST — when a probe signal is absent the component is UNKNOWN,
 * never fabricated as HEALTHY.
 */

export const HEALTH_COMPONENTS = [
  'APPLICATION', 'DATABASE', 'QUEUE', 'WORKER', 'PROVIDER_AGGREGATE', 'WEBHOOK', 'AI_GATEWAY',
] as const;
export type HealthComponent = (typeof HEALTH_COMPONENTS)[number];

export const HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** A component's verdict: state + a terse, infra-free reason code. */
export interface ComponentHealth {
  state: HealthState;
  /** Short machine-ish code, e.g. 'ok', 'db_unreachable', 'no_signal'. Never secrets or infra detail. */
  reason: string;
}

export interface HealthReport {
  /** Rollup across components (worst severity). */
  status: HealthState;
  components: Record<HealthComponent, ComponentHealth>;
  at: string;
}

/**
 * Injected probe signals. Every field is OPTIONAL: an absent signal yields UNKNOWN for its component
 * (fail honest). Durations are milliseconds; error rates are 0..1 over a recent window.
 */
export interface HealthSignals {
  /** True when the serving process is handling the request normally; defaults to alive (liveness). */
  applicationError?: boolean;
  /** Did a trivial DB round-trip (e.g. `select 1`) succeed? */
  dbReachable?: boolean;
  /** Pending items in the work queue. */
  queueDepth?: number;
  /** Age of the most recent worker heartbeat/tick. */
  workerLastTickAgeMs?: number;
  /** Provider-call error rate across all providers (0..1). */
  providerErrorRate?: number;
  /** Age of the most recent verified inbound webhook. */
  webhookLastEventAgeMs?: number;
  /** AI gateway error rate (0..1). */
  aiGatewayErrorRate?: number;

  // ---- Phase C.6 (24) — deeper probe signals (all optional; absent = not considered) ----
  /** Age of the OLDEST still-pending queue job (head-of-line latency, not just depth). */
  queueOldestJobAgeMs?: number;
  /** Age of the most recent worker liveness heartbeat (distinct from job-processing tick). */
  workerHeartbeatAgeMs?: number;
  /** Count of provider connections currently flagged as needing reauthorization. */
  providerReauthRequiredCount?: number;
  /** Rate of webhook deliveries failing signature verification (0..1). */
  webhookSignatureFailureRate?: number;
  /** AI gateway circuit-breaker state. */
  aiGatewayBreakerState?: 'closed' | 'half_open' | 'open';
}

export interface HealthThresholds {
  queueDepthDegraded: number;
  queueDepthUnavailable: number;
  workerTickDegradedMs: number;
  workerTickUnavailableMs: number;
  providerErrorDegraded: number;
  providerErrorUnavailable: number;
  webhookAgeDegradedMs: number;
  webhookAgeUnavailableMs: number;
  aiGatewayErrorDegraded: number;
  aiGatewayErrorUnavailable: number;
  // ---- Phase C.6 (24) ----
  queueOldestJobDegradedMs: number;
  queueOldestJobUnavailableMs: number;
  workerHeartbeatDegradedMs: number;
  workerHeartbeatUnavailableMs: number;
  providerReauthDegradedCount: number;
  providerReauthUnavailableCount: number;
  webhookSigFailureDegraded: number;
  webhookSigFailureUnavailable: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  queueDepthDegraded: 500,
  queueDepthUnavailable: 5000,
  workerTickDegradedMs: 2 * 60_000,
  workerTickUnavailableMs: 10 * 60_000,
  providerErrorDegraded: 0.1,
  providerErrorUnavailable: 0.5,
  webhookAgeDegradedMs: 6 * 60 * 60_000,
  webhookAgeUnavailableMs: 24 * 60 * 60_000,
  aiGatewayErrorDegraded: 0.1,
  aiGatewayErrorUnavailable: 0.5,
  queueOldestJobDegradedMs: 5 * 60_000,
  queueOldestJobUnavailableMs: 30 * 60_000,
  workerHeartbeatDegradedMs: 60_000,
  workerHeartbeatUnavailableMs: 5 * 60_000,
  providerReauthDegradedCount: 1,
  providerReauthUnavailableCount: 5,
  webhookSigFailureDegraded: 0.05,
  webhookSigFailureUnavailable: 0.3,
};

/** A rate signal: UNKNOWN if absent, else banded against two thresholds. */
function byErrorRate(rate: number | undefined, degraded: number, unavailable: number, label: string): ComponentHealth {
  if (rate == null || !Number.isFinite(rate)) return { state: 'UNKNOWN', reason: 'no_signal' };
  if (rate >= unavailable) return { state: 'UNAVAILABLE', reason: `${label}_error_rate_critical` };
  if (rate >= degraded) return { state: 'DEGRADED', reason: `${label}_error_rate_elevated` };
  return { state: 'HEALTHY', reason: 'ok' };
}

const SEVERITY: Record<HealthState, number> = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, UNAVAILABLE: 3 };

/**
 * An ascending-threshold band (bigger is worse): UNKNOWN if the value is absent, else HEALTHY /
 * DEGRADED / UNAVAILABLE. Returns `null` when absent so it can be combined with other sub-signals
 * (vs. a standalone UNKNOWN).
 */
function byAscending(
  value: number | undefined,
  degraded: number,
  unavailable: number,
  degradedReason: string,
  unavailableReason: string,
): ComponentHealth | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= unavailable) return { state: 'UNAVAILABLE', reason: unavailableReason };
  if (value >= degraded) return { state: 'DEGRADED', reason: degradedReason };
  return { state: 'HEALTHY', reason: 'ok' };
}

/** Error-rate band that yields `null` when absent (combinable variant of `byErrorRate`). */
function byErrorRateOpt(rate: number | undefined, degraded: number, unavailable: number, label: string): ComponentHealth | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return byErrorRate(rate, degraded, unavailable, label);
}

/**
 * Combine several sub-verdicts into one component verdict: the WORST present sub-verdict wins. When
 * EVERY sub-verdict is absent the component is UNKNOWN/no_signal (FAIL HONEST — never fabricated HEALTHY).
 */
function worstOf(...verdicts: Array<ComponentHealth | null>): ComponentHealth {
  let best: ComponentHealth | null = null;
  for (const v of verdicts) {
    if (!v) continue;
    if (!best || SEVERITY[v.state] > SEVERITY[best.state]) best = v;
  }
  return best ?? { state: 'UNKNOWN', reason: 'no_signal' };
}

/**
 * Compute every component's health purely from the given signals + thresholds. Absent signals are
 * UNKNOWN. The rollup `status` is the worst component severity (UNAVAILABLE > DEGRADED > UNKNOWN >
 * HEALTHY).
 */
export function computeHealth(
  signals: HealthSignals,
  opts: { now?: string | Date; thresholds?: Partial<HealthThresholds> } = {},
): HealthReport {
  const t = { ...DEFAULT_HEALTH_THRESHOLDS, ...opts.thresholds };
  const at = new Date(opts.now ?? new Date()).toISOString();

  const application: ComponentHealth = signals.applicationError === true
    ? { state: 'UNAVAILABLE', reason: 'application_error' }
    : { state: 'HEALTHY', reason: 'ok' }; // the handler is executing → process is alive.

  const database: ComponentHealth = signals.dbReachable == null
    ? { state: 'UNKNOWN', reason: 'no_signal' }
    : signals.dbReachable
      ? { state: 'HEALTHY', reason: 'ok' }
      : { state: 'UNAVAILABLE', reason: 'db_unreachable' };

  // QUEUE: worst of backlog depth and oldest-job (head-of-line) age.
  const queue = worstOf(
    byAscending(signals.queueDepth, t.queueDepthDegraded, t.queueDepthUnavailable, 'queue_backlog_high', 'queue_backlog_critical'),
    byAscending(signals.queueOldestJobAgeMs, t.queueOldestJobDegradedMs, t.queueOldestJobUnavailableMs, 'queue_oldest_job_stale', 'queue_oldest_job_stale_critical'),
  );

  // WORKER: worst of job-processing tick age and liveness-heartbeat staleness.
  const worker = worstOf(
    byAscending(signals.workerLastTickAgeMs, t.workerTickDegradedMs, t.workerTickUnavailableMs, 'worker_tick_lagging', 'worker_tick_stalled'),
    byAscending(signals.workerHeartbeatAgeMs, t.workerHeartbeatDegradedMs, t.workerHeartbeatUnavailableMs, 'worker_heartbeat_stale', 'worker_heartbeat_stalled'),
  );

  // PROVIDER_AGGREGATE: worst of call error rate and reauth-required backlog.
  const providerAggregate = worstOf(
    byErrorRateOpt(signals.providerErrorRate, t.providerErrorDegraded, t.providerErrorUnavailable, 'provider'),
    byAscending(signals.providerReauthRequiredCount, t.providerReauthDegradedCount, t.providerReauthUnavailableCount, 'provider_reauth_required', 'provider_reauth_required_critical'),
  );

  // WEBHOOK: worst of silence (no recent verified event) and signature-failure rate.
  const webhookSilence = byAscending(signals.webhookLastEventAgeMs, t.webhookAgeDegradedMs, t.webhookAgeUnavailableMs, 'webhook_silent', 'webhook_silent_critical');
  const webhook = worstOf(
    webhookSilence,
    byErrorRateOpt(signals.webhookSignatureFailureRate, t.webhookSigFailureDegraded, t.webhookSigFailureUnavailable, 'webhook_signature_failure'),
  );

  // AI_GATEWAY: worst of error rate and circuit-breaker state.
  const breaker: ComponentHealth | null = signals.aiGatewayBreakerState == null
    ? null
    : signals.aiGatewayBreakerState === 'open'
      ? { state: 'UNAVAILABLE', reason: 'ai_gateway_breaker_open' }
      : signals.aiGatewayBreakerState === 'half_open'
        ? { state: 'DEGRADED', reason: 'ai_gateway_breaker_half_open' }
        : { state: 'HEALTHY', reason: 'ok' };
  const aiGateway = worstOf(
    byErrorRateOpt(signals.aiGatewayErrorRate, t.aiGatewayErrorDegraded, t.aiGatewayErrorUnavailable, 'ai_gateway'),
    breaker,
  );

  const components: Record<HealthComponent, ComponentHealth> = {
    APPLICATION: application,
    DATABASE: database,
    QUEUE: queue,
    WORKER: worker,
    PROVIDER_AGGREGATE: providerAggregate,
    WEBHOOK: webhook,
    AI_GATEWAY: aiGateway,
  };

  const status = (Object.values(components) as ComponentHealth[])
    .reduce<HealthState>((worst, c) => (SEVERITY[c.state] > SEVERITY[worst] ? c.state : worst), 'HEALTHY');

  return { status, components, at };
}

/** HTTP status for the rollup: healthy/degraded/unknown are reachable (200); unavailable is 503. */
export function healthHttpStatus(status: HealthState): number {
  return status === 'UNAVAILABLE' ? 503 : 200;
}
