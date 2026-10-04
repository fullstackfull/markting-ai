import { describe, expect, it } from 'vitest';
import { HEALTH_COMPONENTS, computeHealth } from '@/lib/markting/ops/health';

/**
 * Phase C.6 (24) — health deepening. New probe signals (queue oldest-job age, worker heartbeat staleness,
 * provider reauth-required count, webhook signature-failure rate, AI gateway breaker state) each band to
 * DEGRADED/UNAVAILABLE, combine worst-of with the existing per-component signals, stay FAIL-HONEST (absent
 * everything → UNKNOWN) and OPERATOR-SAFE (no infra/secret in reasons).
 */
const NOW = '2026-10-04T12:00:00Z';

describe('C.6-24 — queue oldest-job age', () => {
  it('bands by oldest-job age even when depth is absent', () => {
    expect(computeHealth({ queueOldestJobAgeMs: 60_000 }, { now: NOW }).components.QUEUE.state).toBe('HEALTHY');
    expect(computeHealth({ queueOldestJobAgeMs: 10 * 60_000 }, { now: NOW }).components.QUEUE).toEqual({ state: 'DEGRADED', reason: 'queue_oldest_job_stale' });
    expect(computeHealth({ queueOldestJobAgeMs: 60 * 60_000 }, { now: NOW }).components.QUEUE).toEqual({ state: 'UNAVAILABLE', reason: 'queue_oldest_job_stale_critical' });
  });

  it('takes the worst of depth and oldest-job age', () => {
    const r = computeHealth({ queueDepth: 10, queueOldestJobAgeMs: 60 * 60_000 }, { now: NOW });
    expect(r.components.QUEUE).toEqual({ state: 'UNAVAILABLE', reason: 'queue_oldest_job_stale_critical' });
  });
});

describe('C.6-24 — worker heartbeat staleness', () => {
  it('bands distinctly from tick age', () => {
    expect(computeHealth({ workerHeartbeatAgeMs: 10_000 }, { now: NOW }).components.WORKER.state).toBe('HEALTHY');
    expect(computeHealth({ workerHeartbeatAgeMs: 90_000 }, { now: NOW }).components.WORKER).toEqual({ state: 'DEGRADED', reason: 'worker_heartbeat_stale' });
    expect(computeHealth({ workerHeartbeatAgeMs: 10 * 60_000 }, { now: NOW }).components.WORKER).toEqual({ state: 'UNAVAILABLE', reason: 'worker_heartbeat_stalled' });
  });

  it('worst of tick age and heartbeat age', () => {
    const r = computeHealth({ workerLastTickAgeMs: 5 * 60_000, workerHeartbeatAgeMs: 10 * 60_000 }, { now: NOW });
    expect(r.components.WORKER.state).toBe('UNAVAILABLE');
  });
});

describe('C.6-24 — provider reauth-required count', () => {
  it('bands by count and merges worst-of with error rate', () => {
    expect(computeHealth({ providerReauthRequiredCount: 0 }, { now: NOW }).components.PROVIDER_AGGREGATE.state).toBe('HEALTHY');
    expect(computeHealth({ providerReauthRequiredCount: 2 }, { now: NOW }).components.PROVIDER_AGGREGATE).toEqual({ state: 'DEGRADED', reason: 'provider_reauth_required' });
    expect(computeHealth({ providerReauthRequiredCount: 9 }, { now: NOW }).components.PROVIDER_AGGREGATE).toEqual({ state: 'UNAVAILABLE', reason: 'provider_reauth_required_critical' });
    const r = computeHealth({ providerErrorRate: 0.01, providerReauthRequiredCount: 9 }, { now: NOW });
    expect(r.components.PROVIDER_AGGREGATE.state).toBe('UNAVAILABLE');
  });
});

describe('C.6-24 — webhook signature-failure rate', () => {
  it('bands by signature-failure rate and takes worst-of with silence', () => {
    expect(computeHealth({ webhookSignatureFailureRate: 0.0 }, { now: NOW }).components.WEBHOOK.state).toBe('HEALTHY');
    expect(computeHealth({ webhookSignatureFailureRate: 0.1 }, { now: NOW }).components.WEBHOOK.state).toBe('DEGRADED');
    expect(computeHealth({ webhookSignatureFailureRate: 0.5 }, { now: NOW }).components.WEBHOOK.state).toBe('UNAVAILABLE');
    const r = computeHealth({ webhookLastEventAgeMs: 60_000, webhookSignatureFailureRate: 0.5 }, { now: NOW });
    expect(r.components.WEBHOOK.state).toBe('UNAVAILABLE');
  });
});

describe('C.6-24 — AI gateway breaker state', () => {
  it('maps closed→HEALTHY, half_open→DEGRADED, open→UNAVAILABLE', () => {
    expect(computeHealth({ aiGatewayBreakerState: 'closed' }, { now: NOW }).components.AI_GATEWAY).toEqual({ state: 'HEALTHY', reason: 'ok' });
    expect(computeHealth({ aiGatewayBreakerState: 'half_open' }, { now: NOW }).components.AI_GATEWAY).toEqual({ state: 'DEGRADED', reason: 'ai_gateway_breaker_half_open' });
    expect(computeHealth({ aiGatewayBreakerState: 'open' }, { now: NOW }).components.AI_GATEWAY).toEqual({ state: 'UNAVAILABLE', reason: 'ai_gateway_breaker_open' });
  });

  it('worst-of with error rate', () => {
    const r = computeHealth({ aiGatewayErrorRate: 0.01, aiGatewayBreakerState: 'open' }, { now: NOW });
    expect(r.components.AI_GATEWAY.state).toBe('UNAVAILABLE');
  });
});

describe('C.6-24 — fail honest + operator safe for new signals', () => {
  it('absent new signals keep components UNKNOWN/no_signal (no fabrication)', () => {
    const r = computeHealth({}, { now: NOW });
    for (const c of ['DATABASE', 'QUEUE', 'WORKER', 'PROVIDER_AGGREGATE', 'WEBHOOK', 'AI_GATEWAY'] as const) {
      expect(r.components[c]).toEqual({ state: 'UNKNOWN', reason: 'no_signal' });
    }
    expect(r.status).toBe('UNKNOWN');
  });

  it('reasons from new signals carry no secret/infra detail', () => {
    const r = computeHealth(
      {
        queueOldestJobAgeMs: 60 * 60_000,
        workerHeartbeatAgeMs: 10 * 60_000,
        providerReauthRequiredCount: 9,
        webhookSignatureFailureRate: 0.9,
        aiGatewayBreakerState: 'open',
      },
      { now: NOW },
    );
    const json = JSON.stringify(r).toLowerCase();
    for (const needle of ['postgres', '://', 'password', 'secret', 'token', 'localhost', 'stack', 'version', 'bearer']) {
      expect(json).not.toContain(needle);
    }
    for (const c of HEALTH_COMPONENTS) {
      expect(Object.keys(r.components[c]).sort()).toEqual(['reason', 'state']);
    }
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('custom thresholds for new signals are honored', () => {
    const r = computeHealth({ providerReauthRequiredCount: 1 }, { now: NOW, thresholds: { providerReauthUnavailableCount: 1 } });
    expect(r.components.PROVIDER_AGGREGATE.state).toBe('UNAVAILABLE');
  });
});
