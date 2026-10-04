import { describe, expect, it } from 'vitest';
import {
  planDispatch, onFailure, onSuccess, leaseJob, backoffMs, DEFAULT_SYNC_LIMITS, SYNC_TYPE_PRIORITY,
  type SyncJob, type DispatchContext, type SyncLimits,
} from '@/lib/markting/ops/sync-runner';

/**
 * PHASE C (C8) — the pure sync-runner scheduling model: bounded concurrency, per-tenant fairness,
 * provider rate limits, lease reclaim, exponential backoff + dead-letter, kill-switch gating, and
 * idempotent transitions. The live provider execution loop is BLOCKED_EXTERNAL; this proves the
 * decision logic without it.
 */
const NOW = 1_000_000;
let seq = 0;
function job(p: Partial<SyncJob> = {}): SyncJob {
  seq += 1;
  return {
    id: p.id ?? `j${seq}`,
    organizationId: p.organizationId ?? 'orgA',
    provider: p.provider ?? 'meta',
    type: p.type ?? 'INCREMENTAL',
    state: p.state ?? 'QUEUED',
    idempotencyKey: p.idempotencyKey ?? `k${seq}`,
    attempts: p.attempts ?? 0,
    notBeforeMs: p.notBeforeMs ?? 0,
    leaseExpiresAtMs: p.leaseExpiresAtMs,
    priority: p.priority ?? SYNC_TYPE_PRIORITY[p.type ?? 'INCREMENTAL'],
    enqueuedAtMs: p.enqueuedAtMs ?? NOW,
  };
}
const ctx = (over: Partial<DispatchContext> = {}): DispatchContext => ({
  now: NOW, limits: DEFAULT_SYNC_LIMITS, inflight: [], rate: {}, isKilled: () => false, ...over,
});

describe('C8 — planDispatch', () => {
  it('respects global max concurrency', () => {
    const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, maxConcurrent: 2, maxPerOrg: 10 };
    const q = [job(), job({ organizationId: 'orgB' }), job({ organizationId: 'orgC' })];
    const d = planDispatch(q, ctx({ limits }));
    expect(d.dispatch).toHaveLength(2);
    expect(d.skipped.find((s) => s.reason === 'MAX_CONCURRENT')).toBeTruthy();
  });

  it('enforces per-org fairness (one tenant cannot monopolize the pool)', () => {
    const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, maxConcurrent: 8, maxPerOrg: 2 };
    const q = [job(), job(), job(), job()]; // 4 jobs all orgA
    const d = planDispatch(q, ctx({ limits }));
    expect(d.dispatch).toHaveLength(2); // capped at maxPerOrg
    expect(d.skipped.filter((s) => s.reason === 'ORG_FAIRNESS_CAP')).toHaveLength(2);
  });

  it('shares slots fairly across tenants under the per-org cap', () => {
    const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, maxConcurrent: 4, maxPerOrg: 2 };
    const q = [job({ organizationId: 'orgA' }), job({ organizationId: 'orgA' }), job({ organizationId: 'orgA' }),
              job({ organizationId: 'orgB' }), job({ organizationId: 'orgB' })];
    const d = planDispatch(q, ctx({ limits }));
    const byOrg = d.dispatch.reduce<Record<string, number>>((m, j) => ({ ...m, [j.organizationId]: (m[j.organizationId] ?? 0) + 1 }), {});
    expect(byOrg.orgA).toBe(2);
    expect(byOrg.orgB).toBe(2);
  });

  it('honors provider rate budget (token bucket)', () => {
    const q = [job({ provider: 'meta' }), job({ provider: 'meta' }), job({ provider: 'google' })];
    const d = planDispatch(q, ctx({ rate: { meta: { availableTokens: 1 }, google: { availableTokens: 5 } }, limits: { ...DEFAULT_SYNC_LIMITS, maxPerOrg: 10 } }));
    expect(d.dispatch.filter((j) => j.provider === 'meta')).toHaveLength(1);
    expect(d.dispatch.filter((j) => j.provider === 'google')).toHaveLength(1);
    expect(d.skipped.find((s) => s.reason === 'RATE_LIMITED')).toBeTruthy();
  });

  it('skips jobs in backoff wait and dead-lettered jobs', () => {
    const q = [job({ notBeforeMs: NOW + 10_000 }), job({ attempts: DEFAULT_SYNC_LIMITS.maxAttempts })];
    const d = planDispatch(q, ctx());
    expect(d.dispatch).toHaveLength(0);
    expect(d.skipped.map((s) => s.reason).sort()).toEqual(['BACKOFF_WAIT', 'DEAD_LETTER']);
  });

  it('never dispatches a killed job', () => {
    const q = [job({ provider: 'meta' }), job({ provider: 'google' })];
    const d = planDispatch(q, ctx({ isKilled: (j) => j.provider === 'meta' }));
    expect(d.dispatch.every((j) => j.provider !== 'meta')).toBe(true);
    expect(d.skipped.find((s) => s.reason === 'KILL_SWITCH')).toBeTruthy();
  });

  it('reclaims a lease-expired in-flight job (crash recovery)', () => {
    const stuck = job({ id: 'stuck', state: 'LEASED', leaseExpiresAtMs: NOW - 1 });
    const d = planDispatch([], ctx({ inflight: [stuck] }));
    expect(d.dispatch.map((j) => j.id)).toContain('stuck');
  });

  it('a live (non-expired) lease counts against concurrency and is not re-dispatched', () => {
    const live = job({ id: 'live', state: 'LEASED', leaseExpiresAtMs: NOW + 60_000 });
    const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, maxConcurrent: 1 };
    const d = planDispatch([job()], ctx({ inflight: [live], limits }));
    expect(d.dispatch).toHaveLength(0);
    expect(d.skipped.find((s) => s.reason === 'MAX_CONCURRENT')).toBeTruthy();
  });

  it('orders by priority then FIFO (REAUTH before INITIAL backfill)', () => {
    const limits: SyncLimits = { ...DEFAULT_SYNC_LIMITS, maxConcurrent: 1, maxPerOrg: 1 };
    const q = [job({ id: 'backfill', type: 'INITIAL' }), job({ id: 'reauth', type: 'REAUTH_REQUIRED' })];
    const d = planDispatch(q, ctx({ limits }));
    expect(d.dispatch[0]!.id).toBe('reauth');
  });
});

describe('C8 — retry / backoff / dead-letter transitions', () => {
  it('backoff is exponential, jittered, and capped', () => {
    const limits = DEFAULT_SYNC_LIMITS;
    const b1 = backoffMs(1, limits, () => 0); // floor of full-jitter = exp/2
    const b3 = backoffMs(3, limits, () => 0);
    expect(b1).toBe(limits.backoffBaseMs / 2);
    expect(b3).toBe((limits.backoffBaseMs * 4) / 2);
    expect(backoffMs(999, limits, () => 1)).toBe(limits.backoffCapMs); // capped at full jitter=1
  });

  it('onFailure schedules a future retry until max attempts, then dead-letters', () => {
    let j = job();
    for (let i = 0; i < DEFAULT_SYNC_LIMITS.maxAttempts - 1; i++) {
      j = onFailure(j, { now: NOW, limits: DEFAULT_SYNC_LIMITS, rand: () => 0.5 });
      expect(j.state).toBe('RETRY_WAIT');
      expect(j.notBeforeMs).toBeGreaterThan(NOW);
    }
    j = onFailure(j, { now: NOW, limits: DEFAULT_SYNC_LIMITS });
    expect(j.state).toBe('DEAD_LETTER');
  });

  it('onSuccess + leaseJob are terminal / lease-bearing as expected', () => {
    expect(onSuccess(job()).state).toBe('SUCCEEDED');
    const leased = leaseJob(job(), NOW, 60_000);
    expect(leased.state).toBe('LEASED');
    expect(leased.leaseExpiresAtMs).toBe(NOW + 60_000);
  });
});
