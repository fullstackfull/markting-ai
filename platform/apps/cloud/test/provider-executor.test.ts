import { describe, expect, it } from 'vitest';
import { paginate, type PageSource } from '@/lib/markting/ops/provider-pagination';
import {
  runProviderRead, toExecOutcome, ProviderSignal, registerProviderTransport, resolveProviderTransport,
  resetProviderRegistryForTests, DEFAULT_EXECUTOR_BUDGET, type ProviderTransport, type ExecutorBudget,
} from '@/lib/markting/ops/provider-executor';
import type { SyncJob } from '@/lib/markting/ops/sync-runner';

const job = (): SyncJob => ({ id: 'j1', organizationId: 'orgA', provider: 'meta', type: 'INCREMENTAL', state: 'LEASED', idempotencyKey: 'k', attempts: 0, notBeforeMs: 0, priority: 3, enqueuedAtMs: 0 });
const OK = { connectionActive: true, sourceModeAllows: true };
const budget = (o: Partial<ExecutorBudget> = {}): ExecutorBudget => ({ ...DEFAULT_EXECUTOR_BUDGET, ...o });

// A token-paginated fake source producing `total` rows in pages of `limit`.
function tokenSource(total: number, limit: number): PageSource<number> {
  return {
    style: 'next_page_token', limit,
    async fetchPage(req) {
      const start = req.cursor ? Number(req.cursor) : 0;
      const rows = Array.from({ length: Math.min(limit, total - start) }, (_, i) => start + i);
      const next = start + limit < total ? String(start + limit) : null;
      return { rows, nextCursor: next };
    },
  };
}

describe('C.6-3 — pagination framework', () => {
  it('traverses all pages to COMPLETE', async () => {
    const r = await paginate(tokenSource(25, 10), { maxPages: 100, maxRows: 1000 });
    expect(r.rows).toHaveLength(25);
    expect(r.stop).toBe('COMPLETE');
    expect(r.resumeCursor).toBeNull();
  });
  it('stops at maxRows with a resume cursor', async () => {
    const r = await paginate(tokenSource(100, 10), { maxPages: 100, maxRows: 15 });
    expect(r.rows).toHaveLength(15);
    expect(r.stop).toBe('MAX_ROWS');
    expect(r.resumeCursor).not.toBeNull();
  });
  it('stops at maxPages', async () => {
    const r = await paginate(tokenSource(100, 10), { maxPages: 2, maxRows: 1000 });
    expect(r.stop).toBe('MAX_PAGES');
    expect(r.pages).toBe(2);
  });
  it('detects a non-advancing provider (LOOP_DETECTED)', async () => {
    const stuck: PageSource<number> = { style: 'cursor', limit: 10, async fetchPage() { return { rows: [1], nextCursor: 'same' }; } };
    const r = await paginate(stuck, { maxPages: 1000, maxRows: 1000 });
    expect(r.stop).toBe('LOOP_DETECTED');
  });
  it('honors the deadline and cancellation', async () => {
    const rD = await paginate(tokenSource(100, 10), { maxPages: 100, maxRows: 1000, deadlineMs: 50 }, { now: () => 100 });
    expect(rD.stop).toBe('DEADLINE');
    let calls = 0;
    const rA = await paginate(tokenSource(100, 10), { maxPages: 100, maxRows: 1000 }, { isAborted: () => ++calls > 1 });
    expect(rA.stop).toBe('ABORTED');
  });
  it('offset/limit style advances by offset', async () => {
    const src: PageSource<number> = {
      style: 'offset_limit', limit: 10,
      async fetchPage(req) { const o = req.offset ?? 0; const rows = o < 30 ? Array.from({ length: 10 }, (_, i) => o + i) : []; return { rows, nextCursor: o + 10 < 30 ? String(o + 10) : null }; },
    };
    const r = await paginate(src, { maxPages: 100, maxRows: 1000 });
    expect(r.rows).toHaveLength(30);
    expect(r.stop).toBe('COMPLETE');
  });
});

function transport(over: Partial<ProviderTransport<number>> = {}): ProviderTransport<number> {
  return { provider: 'meta', pageSource: () => tokenSource(20, 10), classifyRow: () => 'ACCEPT', ...over };
}

describe('C.6-1/2/4 — provider executor shell + result contract', () => {
  it('SUCCESS on a complete read; envelope has required fields, no secrets', async () => {
    const r = await runProviderRead(job(), transport(), budget(), OK);
    expect(r.status).toBe('SUCCESS');
    expect(r).toMatchObject({ provider: 'meta', organizationId: 'orgA', rowsAccepted: 20, rowsRejected: 0, retryable: false, errorClass: 'NONE' });
    expect(r.startedAt).toBeTruthy(); expect(r.completedAt).toBeTruthy();
  });
  it('PARTIAL_SUCCESS (resumable) when bounded by maxRows', async () => {
    const r = await runProviderRead(job(), transport({ pageSource: () => tokenSource(100, 10) }), budget({ maxRows: 25 }), OK);
    expect(r.status).toBe('PARTIAL_SUCCESS');
    expect(r.resumeCursor).not.toBeNull();
    expect(r.retryable).toBe(true);
  });
  it('SCHEMA_CHANGED when a row classifies as schema drift (takes precedence)', async () => {
    const r = await runProviderRead(job(), transport({ classifyRow: (n) => (n === 5 ? 'SCHEMA' : 'ACCEPT') }), budget(), OK);
    expect(r.status).toBe('SCHEMA_CHANGED');
    expect(r.retryable).toBe(false);
    expect(r.errorClass).toBe('SCHEMA');
  });
  it('REAUTH_REQUIRED on an AUTH signal and on a disabled connection (never retryable)', async () => {
    const auth = await runProviderRead(job(), transport({ pageSource: () => ({ style: 'cursor', limit: 10, async fetchPage() { throw new ProviderSignal('AUTH', 'bad token'); } }) }), budget(), OK);
    expect(auth.status).toBe('REAUTH_REQUIRED'); expect(auth.retryable).toBe(false);
    const disabled = await runProviderRead(job(), transport(), budget(), { connectionActive: false, sourceModeAllows: true });
    expect(disabled.status).toBe('REAUTH_REQUIRED');
  });
  it('RATE_LIMITED propagates retryAfterMs', async () => {
    const r = await runProviderRead(job(), transport({ pageSource: () => ({ style: 'cursor', limit: 10, async fetchPage() { throw new ProviderSignal('RATE_LIMIT', 'slow down', 4000); } }) }), budget(), OK);
    expect(r.status).toBe('RATE_LIMITED'); expect(r.retryAfterMs).toBe(4000); expect(r.retryable).toBe(true);
  });
  it('PROVIDER_ERROR transient=retryable, permanent=not', async () => {
    const t = await runProviderRead(job(), transport({ pageSource: () => ({ style: 'cursor', limit: 10, async fetchPage() { throw new ProviderSignal('TRANSIENT', 'blip'); } }) }), budget(), OK);
    expect(t).toMatchObject({ status: 'PROVIDER_ERROR', retryable: true });
    const p = await runProviderRead(job(), transport({ pageSource: () => ({ style: 'cursor', limit: 10, async fetchPage() { throw new ProviderSignal('PERMANENT', 'gone'); } }) }), budget(), OK);
    expect(p).toMatchObject({ status: 'PROVIDER_ERROR', retryable: false });
  });
  it('UNKNOWN on an unclassified throw (never blind success)', async () => {
    const r = await runProviderRead(job(), transport({ pageSource: () => ({ style: 'cursor', limit: 10, async fetchPage() { throw new Error('???'); } }) }), budget(), OK);
    expect(r.status).toBe('UNKNOWN'); expect(r.errorClass).toBe('AMBIGUOUS');
  });
  it('source-mode guard blocks before any read', async () => {
    const r = await runProviderRead(job(), transport(), budget(), { connectionActive: true, sourceModeAllows: false });
    expect(r.status).toBe('PROVIDER_ERROR'); expect(r.errorClass).toBe('PERMANENT');
  });
  it('toExecOutcome maps canonical result → worker outcome', () => {
    expect(toExecOutcome({ status: 'SUCCESS' } as never)).toEqual({ status: 'OK' });
    expect(toExecOutcome({ status: 'UNKNOWN', evidence: 'x' } as never)).toMatchObject({ status: 'UNKNOWN' });
    expect(toExecOutcome({ status: 'REAUTH_REQUIRED', errorClass: 'AUTH' } as never)).toMatchObject({ status: 'ERROR' });
  });
  it('registry registers/resolves provider transports', () => {
    resetProviderRegistryForTests();
    registerProviderTransport(transport());
    expect(resolveProviderTransport('meta')?.provider).toBe('meta');
    expect(resolveProviderTransport('nope')).toBeUndefined();
  });
});
