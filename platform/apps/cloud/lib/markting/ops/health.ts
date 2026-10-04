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

  const queue: ComponentHealth = signals.queueDepth == null || !Number.isFinite(signals.queueDepth)
    ? { state: 'UNKNOWN', reason: 'no_signal' }
    : signals.queueDepth >= t.queueDepthUnavailable
      ? { state: 'UNAVAILABLE', reason: 'queue_backlog_critical' }
      : signals.queueDepth >= t.queueDepthDegraded
        ? { state: 'DEGRADED', reason: 'queue_backlog_high' }
        : { state: 'HEALTHY', reason: 'ok' };

  const worker: ComponentHealth = signals.workerLastTickAgeMs == null || !Number.isFinite(signals.workerLastTickAgeMs)
    ? { state: 'UNKNOWN', reason: 'no_signal' }
    : signals.workerLastTickAgeMs >= t.workerTickUnavailableMs
      ? { state: 'UNAVAILABLE', reason: 'worker_tick_stalled' }
      : signals.workerLastTickAgeMs >= t.workerTickDegradedMs
        ? { state: 'DEGRADED', reason: 'worker_tick_lagging' }
        : { state: 'HEALTHY', reason: 'ok' };

  const providerAggregate = byErrorRate(signals.providerErrorRate, t.providerErrorDegraded, t.providerErrorUnavailable, 'provider');

  const webhook: ComponentHealth = signals.webhookLastEventAgeMs == null || !Number.isFinite(signals.webhookLastEventAgeMs)
    ? { state: 'UNKNOWN', reason: 'no_signal' }
    : signals.webhookLastEventAgeMs >= t.webhookAgeUnavailableMs
      ? { state: 'UNAVAILABLE', reason: 'webhook_silent_critical' }
      : signals.webhookLastEventAgeMs >= t.webhookAgeDegradedMs
        ? { state: 'DEGRADED', reason: 'webhook_silent' }
        : { state: 'HEALTHY', reason: 'ok' };

  const aiGateway = byErrorRate(signals.aiGatewayErrorRate, t.aiGatewayErrorDegraded, t.aiGatewayErrorUnavailable, 'ai_gateway');

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
