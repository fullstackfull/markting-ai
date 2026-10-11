import { describe, expect, it } from 'vitest';
import { paginate, type PageRequest, type PageResult, type PageSource } from '@/lib/markting/ops/provider-pagination';
import {
  runProviderRead,
  type ExecutorBudget,
  type ExecutorGuards,
  type ProviderTransport,
} from '@/lib/markting/ops/provider-executor';
import {
  RateLimiter,
  InMemoryCounterStore,
  FakeClock as RateClock,
  type BucketState,
} from '@/lib/markting/ops/rate-limit-policy';
import {
  CostBudgetEngine,
  InMemoryUsageAccumulator,
  FakeClock as CostClock,
  DEFAULT_BUDGET_CONFIG,
} from '@/lib/markting/ops/cost-budgets';
import { evaluateClaim, idempotencyKeyFor, claimsExactlyOnce } from '@/lib/markting/ops/idempotency';
import type { SyncJob } from '@/lib/markting/ops/sync-runner';

// ---- deterministic fake transports (no network) ----
type LoadRow = { id: string };

/** An endless source — never returns a null nextCursor, so only the executor's caps can stop it. */
class InfiniteSource implements PageSource<LoadRow> {
  readonly style = 'cursor' as const;
  readonly limit: number;
  private page = 0;
  constructor(limit: number, private readonly rowsPerPage: number) {
    this.limit = limit;
  }
  async fetchPage(_req: PageRequest): Promise<PageResult<LoadRow>> {
    this.page += 1;
    const rows: LoadRow[] = Array.from({ length: this.rowsPerPage }, (_, i) => ({ id: `${this.page}:${i}` }));
    return { rows, nextCursor: `p:${this.page}` };
  }
}

/** A stuck source — always echoes the same cursor (provider not advancing). */
class StuckSource implements PageSource<LoadRow> {
  readonly style = 'cursor' as const;
  readonly limit = 10;
  async fetchPage(_req: PageRequest): Promise<PageResult<LoadRow>> {
    return { rows: [{ id: 'x' }], nextCursor: 'STUCK' };
  }
}

function loadTransport(source: PageSource<LoadRow>): ProviderTransport<LoadRow> {
  return {
    provider: 'loadtest',
    pageSource: () => source,
    classifyRow: () => 'ACCEPT',
  };
}

const JOB: SyncJob = {
  id: 'job_load', organizationId: 'org_1', provider: 'loadtest', type: 'INCREMENTAL', state: 'LEASED',
  idempotencyKey: 'idem_load', attempts: 1, notBeforeMs: 0, priority: 1, enqueuedAtMs: 0,
};
const GUARDS: ExecutorGuards = { connectionActive: true, sourceModeAllows: true };

describe('ITEM 40 — load: bounded row + page caps hold', () => {
  it('paginate stops at maxRows EXACTLY against an endless source', async () => {
    const res = await paginate(new InfiniteSource(100, 100), { maxPages: 1_000_000, maxRows: 5_000 });
    expect(res.stop).toBe('MAX_ROWS');
    expect(res.rows.length).toBe(5_000); // never one more than the ceiling
    expect(res.resumeCursor).not.toBeNull();
  });

  it('paginate stops at maxPages against an endless source', async () => {
    const res = await paginate(new InfiniteSource(10, 10), { maxPages: 50, maxRows: 1_000_000 });
    expect(res.stop).toBe('MAX_PAGES');
    expect(res.pages).toBe(50);
    expect(res.rows.length).toBe(500);
  });

  it('runProviderRead reports PARTIAL_SUCCESS (resumable) when a cap bounds a huge read', async () => {
    const budget: ExecutorBudget = { maxPages: 1_000_000, maxRows: 10_000, timeoutMs: 600_000 };
    const now = () => 1_000_000;
    const result = await runProviderRead(JOB, loadTransport(new InfiniteSource(500, 500)), budget, GUARDS, {}, { now });
    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.rowsRead).toBe(10_000);
    expect(result.rowsRead).toBeLessThanOrEqual(budget.maxRows);
    expect(result.resumeCursor).not.toBeNull();
    expect(result.retryable).toBe(true);
  });
});

describe('ITEM 40 — load: loop protection triggers', () => {
  it('a non-advancing cursor is caught, not spun', async () => {
    const res = await paginate(new StuckSource(), { maxPages: 1_000_000, maxRows: 1_000_000 });
    expect(res.stop).toBe('LOOP_DETECTED');
    expect(res.pages).toBeLessThanOrEqual(2);
  });
});

describe('ITEM 40 — load: rate-limit policy throttles under burst', () => {
  it('a burst beyond the ceiling is throttled; refill admits more after the clock advances', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new RateClock(0);
    const limiter = new RateLimiter(store, clock);
    const ctx = { organizationId: 'org_1', provider: 'google' }; // orgProvider ceiling = 8 + 4 = 12

    let allowed = 0;
    let rejected = 0;
    for (let i = 0; i < 40; i += 1) {
      const d = limiter.check(ctx);
      if (d.allow) allowed += 1;
      else {
        rejected += 1;
        expect(d.retryAfterMs ?? 0).toBeGreaterThan(0);
      }
    }
    expect(allowed).toBe(12); // exactly the binding ceiling, not more
    expect(rejected).toBe(28);

    clock.advance(1_000); // refillPerSec 8 → ~8 more tokens
    expect(limiter.check(ctx).allow).toBe(true);

    // Bounded memory: only the GLOBAL + org:google buckets exist regardless of traffic volume.
    expect(store.size()).toBe(2);
  });
});

describe('ITEM 40 — load: cost budget blocks at cap (admission control)', () => {
  it('hard-stops at the cap and never overspends it', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new CostClock(0);
    const engine = new CostBudgetEngine(acc, clock, DEFAULT_BUDGET_CONFIG);
    const ctx = { scope: 'TENANT' as const, organizationId: 'org_1' };
    const spend = DEFAULT_BUDGET_CONFIG.dailyMicros / 5; // 5 records fill the daily cap exactly

    let lastSpent = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = engine.record(ctx, spend);
      expect(r.hardStop).toBe(false);
      lastSpent = r.spent;
      expect(lastSpent).toBeLessThanOrEqual(DEFAULT_BUDGET_CONFIG.dailyMicros);
    }
    expect(lastSpent).toBe(DEFAULT_BUDGET_CONFIG.dailyMicros);

    // Any further spend is REFUSED and commits nothing — the cap is never exceeded.
    for (let i = 0; i < 10; i += 1) {
      const r = engine.record(ctx, spend);
      expect(r.hardStop).toBe(true);
      expect(r.state).toBe('BLOCKED');
      expect(r.spent).toBeLessThanOrEqual(DEFAULT_BUDGET_CONFIG.dailyMicros);
    }
  });
});

describe('ITEM 40 — load: idempotency dedupes replays under concurrency', () => {
  it('only one of N racing claims wins; the rest see ALREADY_CLAIMED', () => {
    // The store serializes the atomic APPROVED→CLAIMED update; this models that single-winner outcome.
    let current: { state: string; claimToken?: string | null } = { state: 'APPROVED', claimToken: null };
    let won = 0;
    for (let worker = 0; worker < 8; worker += 1) {
      const r = evaluateClaim(current);
      if (r.claimed) {
        won += 1;
        // The atomic UPDATE stamps the claim token while the row is still APPROVED; losing racers
        // therefore observe ALREADY_CLAIMED (token present), never a second successful claim.
        current = { state: 'APPROVED', claimToken: r.claimToken };
      } else {
        expect(r.reason).toBe('ALREADY_CLAIMED');
      }
    }
    expect(won).toBe(1);
  });

  it('idempotency keys are stable across replays of the same operation digest', () => {
    const digest = 'a'.repeat(64);
    expect(idempotencyKeyFor('google', digest)).toBe(idempotencyKeyFor('google', digest));
    expect(claimsExactlyOnce('google')).toBe(true);
    expect(claimsExactlyOnce('meta')).toBe(false);
    expect(idempotencyKeyFor('meta', digest)).toBeNull(); // no provider key → atomic claim + reconcile
  });
});

describe('ITEM 40 — soak: sustained iterations with an injected clock, no unbounded growth', () => {
  it('10k simulated read cycles stay within caps; limiter memory stays constant', async () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new RateClock(0);
    const limiter = new RateLimiter(store, clock);
    const ctx = { organizationId: 'org_soak', provider: 'meta' };
    const budget: ExecutorBudget = { maxPages: 1_000_000, maxRows: 1_000, timeoutMs: 600_000 };

    const ITERATIONS = 10_000;
    let throttled = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      // Advance the fake clock one "minute" per cycle — a long soak window with NO real waiting.
      clock.advance(60_000);
      const decision = limiter.check(ctx);
      if (!decision.allow) {
        throttled += 1;
        continue;
      }
      // A fresh bounded read each cycle — rows are always capped, memory never accumulates run-to-run.
      const now = () => clock.now();
      const result = await runProviderRead(JOB, loadTransport(new InfiniteSource(1_000, 1_000)), budget, GUARDS, {}, { now });
      expect(result.rowsRead).toBeLessThanOrEqual(budget.maxRows);
      expect(result.status).toBe('PARTIAL_SUCCESS'); // bounded by the row cap, resumable
    }

    // The limiter never stored more than its two scope keys across 10k cycles (no leak / unbounded growth).
    expect(store.size()).toBe(2);
    // With a full minute of refill per cycle the steady-state rate is never exceeded — nothing throttled.
    expect(throttled).toBe(0);
  });

  it('a tight burst within a single instant IS throttled (the soak cap actually bites)', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new RateClock(1_000);
    const limiter = new RateLimiter(store, clock);
    const ctx = { organizationId: 'org_soak', provider: 'x' }; // ceiling 3 + 2 = 5
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) if (limiter.check(ctx).allow) allowed += 1; // no clock advance
    expect(allowed).toBe(5);
    expect(store.size()).toBe(2);
  });
});
