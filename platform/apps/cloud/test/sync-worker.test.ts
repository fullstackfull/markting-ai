import { describe, expect, it, vi } from 'vitest';
import { InMemorySyncQueue } from '@/lib/markting/ops/sync-store';
import { runSyncTick, guardJob, SyncWorker, type SyncSafetyPorts, type SyncExecutor, type TickContext } from '@/lib/markting/ops/sync-worker';
import { DEFAULT_SYNC_LIMITS, type SyncJob } from '@/lib/markting/ops/sync-runner';
import { decideSchedule } from '@/lib/markting/ops/sync-scheduler';

const NOW = 2_000_000;
const safeAll: SyncSafetyPorts = { isKilled: () => false, isConnectionActive: () => true, sourceModeAllows: () => true, providerSupportsSync: () => true };
const okExecutor: SyncExecutor = { execute: async () => ({ status: 'OK' }) };

async function seed(q: InMemorySyncQueue, n: number, over: Partial<{ org: string; provider: string }> = {}) {
  for (let i = 0; i < n; i++) {
    await q.enqueue({ organizationId: over.org ?? 'orgA', provider: over.provider ?? 'meta', syncType: 'INCREMENTAL', idempotencyKey: `k${i}`, now: NOW });
  }
}
function ctx(q: InMemorySyncQueue, over: Partial<TickContext> = {}): TickContext {
  return { now: NOW, owner: 'w1', limits: DEFAULT_SYNC_LIMITS, rate: {}, leaseMs: 60_000, store: q, safety: safeAll, executor: okExecutor, rand: () => 0.5, ...over };
}

describe('C.5-1 — sync worker runtime', () => {
  it('enqueue is idempotent on (org, provider, key)', async () => {
    const q = new InMemorySyncQueue();
    const a = await q.enqueue({ organizationId: 'o', provider: 'meta', syncType: 'INITIAL', idempotencyKey: 'dup', now: NOW });
    const b = await q.enqueue({ organizationId: 'o', provider: 'meta', syncType: 'INITIAL', idempotencyKey: 'dup', now: NOW });
    expect(a.id).toBe(b.id);
    expect(q.all()).toHaveLength(1);
  });

  it('a tick dispatches, executes OK, and marks SUCCEEDED', async () => {
    const q = new InMemorySyncQueue(); await seed(q, 2);
    const r = await runSyncTick(ctx(q));
    expect(r.claimed).toBe(2);
    expect(r.succeeded).toBe(2);
    expect(q.all().every((j) => j.state === 'SUCCEEDED')).toBe(true);
  });

  it('an ERROR schedules a jittered retry; repeated errors dead-letter at maxAttempts', async () => {
    const q = new InMemorySyncQueue(); await seed(q, 1);
    const failing: SyncExecutor = { execute: async () => ({ status: 'ERROR', error: 'boom' }) };
    let now = NOW;
    for (let i = 0; i < DEFAULT_SYNC_LIMITS.maxAttempts; i++) {
      const r = await runSyncTick(ctx(q, { executor: failing, now }));
      // advance the clock past the scheduled backoff so the retry is dispatchable next tick
      const job = q.all()[0]!;
      now = (job.notBeforeMs || now) + 1;
      if (job.state === 'DEAD_LETTER') { expect(r.deadLettered).toBe(1); break; }
      expect(['RETRY_WAIT']).toContain(job.state);
    }
    expect(q.all()[0]!.state).toBe('DEAD_LETTER');
  });

  it('an UNKNOWN result is never blind-retried as success (parked, not SUCCEEDED)', async () => {
    const q = new InMemorySyncQueue(); await seed(q, 1);
    const unknown: SyncExecutor = { execute: async () => ({ status: 'UNKNOWN', error: 'timeout after send' }) };
    await runSyncTick(ctx(q, { executor: unknown }));
    expect(q.all()[0]!.state).not.toBe('SUCCEEDED');
  });

  it('guardJob blocks a killed / disabled / wrong-source / unsupported job (and the tick returns it to QUEUED)', async () => {
    const job = { id: 'j', organizationId: 'o', provider: 'meta', type: 'INCREMENTAL', state: 'LEASED', idempotencyKey: 'k', attempts: 0, notBeforeMs: 0, priority: 3, enqueuedAtMs: NOW } as SyncJob;
    expect(await guardJob(job, { ...safeAll, isKilled: () => true })).toBe('KILL_SWITCH');
    expect(await guardJob(job, { ...safeAll, isConnectionActive: () => false })).toBe('CONNECTION_DISABLED');
    expect(await guardJob(job, { ...safeAll, sourceModeAllows: () => false })).toBe('SOURCE_MODE');
    expect(await guardJob(job, { ...safeAll, providerSupportsSync: () => false })).toBe('PROVIDER_UNSUPPORTED');

    const q = new InMemorySyncQueue(); await seed(q, 1);
    const spy: SyncExecutor = { execute: vi.fn(async () => ({ status: 'OK' as const })) };
    const r = await runSyncTick(ctx(q, { safety: { ...safeAll, isKilled: () => true }, executor: spy }));
    expect(r.guarded[0]?.reason).toBe('KILL_SWITCH');
    expect(spy.execute).not.toHaveBeenCalled(); // never executed under a kill switch
    expect(q.all()[0]!.state).toBe('QUEUED');    // returned to the queue, not failed
  });

  it('respects per-org fairness across a tick', async () => {
    const q = new InMemorySyncQueue(); await seed(q, 5);
    const r = await runSyncTick(ctx(q, { limits: { ...DEFAULT_SYNC_LIMITS, maxPerOrg: 2 } }));
    expect(r.claimed).toBe(2);
  });

  it('worker start/stop is idempotent and shuts down gracefully', async () => {
    const q = new InMemorySyncQueue(); await seed(q, 1);
    const w = new SyncWorker(() => ctx(q), 10_000);
    w.start(); w.start(); // idempotent
    expect(w.isRunning).toBe(true);
    await w.stop(); await w.stop();
    expect(w.isRunning).toBe(false);
  });
});

describe('C.5-2 — scheduler cadence', () => {
  const base = { organizationId: 'o', provider: 'meta', connected: true, lastSuccessfulSyncAtMs: NOW } as const;
  it('never-synced → INITIAL', () => {
    expect(decideSchedule({ ...base, lastSuccessfulSyncAtMs: null }, NOW)).toMatchObject({ due: true, syncType: 'INITIAL' });
  });
  it('reauth flag wins over cadence', () => {
    expect(decideSchedule({ ...base, reauthRequired: true }, NOW)).toMatchObject({ due: true, syncType: 'REAUTH_REQUIRED' });
  });
  it('within cadence → not due; elapsed → INCREMENTAL', () => {
    expect(decideSchedule(base, NOW + 10 * 60_000).due).toBe(false);
    expect(decideSchedule(base, NOW + 61 * 60_000)).toMatchObject({ due: true, syncType: 'INCREMENTAL' });
  });
  it('disconnected / non-pollable are never scheduled', () => {
    expect(decideSchedule({ ...base, connected: false }, NOW).due).toBe(false);
    expect(decideSchedule({ ...base, provider: 'unknown-x' }, NOW).due).toBe(false);
  });
  it('commerce polls daily, not near-real-time', () => {
    expect(decideSchedule({ ...base, provider: 'shopify' }, NOW + 2 * 60 * 60_000).due).toBe(false);
    expect(decideSchedule({ ...base, provider: 'shopify' }, NOW + 25 * 60 * 60_000).due).toBe(true);
  });
});
