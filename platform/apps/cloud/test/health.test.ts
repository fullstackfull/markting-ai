import { describe, expect, it } from 'vitest';
import {
  HEALTH_COMPONENTS,
  computeHealth,
  healthHttpStatus,
  type HealthComponent,
} from '@/lib/markting/ops/health';

/**
 * Phase C.5 (7) — component health. Pure; each component banded from signals, absent signals fail
 * honest to UNKNOWN, and the output carries no secret/infra fields.
 */
const NOW = '2026-10-04T12:00:00Z';

describe('C.5-7 — computeHealth fails honest on absent signals', () => {
  it('every probe-driven component is UNKNOWN with no signals (application stays liveness-HEALTHY)', () => {
    const r = computeHealth({}, { now: NOW });
    expect(r.components.APPLICATION.state).toBe('HEALTHY');
    for (const c of ['DATABASE', 'QUEUE', 'WORKER', 'PROVIDER_AGGREGATE', 'WEBHOOK', 'AI_GATEWAY'] as HealthComponent[]) {
      expect(r.components[c].state).toBe('UNKNOWN');
      expect(r.components[c].reason).toBe('no_signal');
    }
    // rollup: UNKNOWN is worse than HEALTHY but better than DEGRADED.
    expect(r.status).toBe('UNKNOWN');
  });

  it('covers exactly the 7 named components', () => {
    const r = computeHealth({}, { now: NOW });
    expect(Object.keys(r.components).sort()).toEqual([...HEALTH_COMPONENTS].sort());
  });
});

describe('C.5-7 — each state computed from signals', () => {
  it('DATABASE: reachable→HEALTHY, unreachable→UNAVAILABLE', () => {
    expect(computeHealth({ dbReachable: true }, { now: NOW }).components.DATABASE).toEqual({ state: 'HEALTHY', reason: 'ok' });
    expect(computeHealth({ dbReachable: false }, { now: NOW }).components.DATABASE).toEqual({ state: 'UNAVAILABLE', reason: 'db_unreachable' });
  });

  it('QUEUE: healthy / degraded / unavailable by depth', () => {
    expect(computeHealth({ queueDepth: 10 }, { now: NOW }).components.QUEUE.state).toBe('HEALTHY');
    expect(computeHealth({ queueDepth: 800 }, { now: NOW }).components.QUEUE.state).toBe('DEGRADED');
    expect(computeHealth({ queueDepth: 9000 }, { now: NOW }).components.QUEUE.state).toBe('UNAVAILABLE');
  });

  it('WORKER: healthy / lagging / stalled by last-tick age', () => {
    expect(computeHealth({ workerLastTickAgeMs: 30_000 }, { now: NOW }).components.WORKER.state).toBe('HEALTHY');
    expect(computeHealth({ workerLastTickAgeMs: 5 * 60_000 }, { now: NOW }).components.WORKER.state).toBe('DEGRADED');
    expect(computeHealth({ workerLastTickAgeMs: 30 * 60_000 }, { now: NOW }).components.WORKER.state).toBe('UNAVAILABLE');
  });

  it('PROVIDER_AGGREGATE + AI_GATEWAY: banded by error rate', () => {
    expect(computeHealth({ providerErrorRate: 0.01 }, { now: NOW }).components.PROVIDER_AGGREGATE.state).toBe('HEALTHY');
    expect(computeHealth({ providerErrorRate: 0.2 }, { now: NOW }).components.PROVIDER_AGGREGATE.state).toBe('DEGRADED');
    expect(computeHealth({ providerErrorRate: 0.8 }, { now: NOW }).components.PROVIDER_AGGREGATE.state).toBe('UNAVAILABLE');
    expect(computeHealth({ aiGatewayErrorRate: 0.6 }, { now: NOW }).components.AI_GATEWAY.state).toBe('UNAVAILABLE');
  });

  it('WEBHOOK: silent for long enough degrades then goes unavailable', () => {
    expect(computeHealth({ webhookLastEventAgeMs: 60_000 }, { now: NOW }).components.WEBHOOK.state).toBe('HEALTHY');
    expect(computeHealth({ webhookLastEventAgeMs: 8 * 60 * 60_000 }, { now: NOW }).components.WEBHOOK.state).toBe('DEGRADED');
    expect(computeHealth({ webhookLastEventAgeMs: 48 * 60 * 60_000 }, { now: NOW }).components.WEBHOOK.state).toBe('UNAVAILABLE');
  });

  it('APPLICATION: explicit error → UNAVAILABLE', () => {
    expect(computeHealth({ applicationError: true }, { now: NOW }).components.APPLICATION.state).toBe('UNAVAILABLE');
  });

  it('rollup status is the worst component severity', () => {
    const r = computeHealth({ dbReachable: false, queueDepth: 5, providerErrorRate: 0.2 }, { now: NOW });
    expect(r.components.QUEUE.state).toBe('HEALTHY');
    expect(r.components.PROVIDER_AGGREGATE.state).toBe('DEGRADED');
    expect(r.components.DATABASE.state).toBe('UNAVAILABLE');
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('custom thresholds are honored', () => {
    const r = computeHealth({ queueDepth: 50 }, { now: NOW, thresholds: { queueDepthDegraded: 10 } });
    expect(r.components.QUEUE.state).toBe('DEGRADED');
  });
});

describe('C.5-7 — operator-safe output (no secrets / infra detail)', () => {
  it('serialized report has only state + terse reason codes', () => {
    const r = computeHealth(
      { dbReachable: false, queueDepth: 9000, workerLastTickAgeMs: 30 * 60_000, providerErrorRate: 0.9, webhookLastEventAgeMs: 48 * 60 * 60_000, aiGatewayErrorRate: 0.9 },
      { now: NOW },
    );
    const json = JSON.stringify(r);
    for (const needle of ['postgres', 'postgresql', '://', 'password', 'secret', 'token', 'localhost', '.supabase.', 'select 1', 'stack', 'version']) {
      expect(json.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    // only the expected shape leaks out
    for (const c of HEALTH_COMPONENTS) {
      expect(Object.keys(r.components[c]).sort()).toEqual(['reason', 'state']);
    }
  });
});

describe('C.5-7 — healthHttpStatus', () => {
  it('maps unavailable→503, everything else→200', () => {
    expect(healthHttpStatus('UNAVAILABLE')).toBe(503);
    expect(healthHttpStatus('HEALTHY')).toBe(200);
    expect(healthHttpStatus('DEGRADED')).toBe(200);
    expect(healthHttpStatus('UNKNOWN')).toBe(200);
  });
});
