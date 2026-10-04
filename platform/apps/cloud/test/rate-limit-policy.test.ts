import { describe, expect, it } from 'vitest';
import {
  decide, decideScoped, peek, decideWindow, rateScopeKey, policyForProvider, policyCeiling,
  PROVIDER_RATE_POLICIES, DEFAULT_RATE_POLICY, DEFAULT_GLOBAL_POLICY,
  FakeClock, InMemoryCounterStore, PostgresCounterStoreStub, RateLimiter,
  type BucketState, type WindowState, type RatePolicy, type RateContext,
} from '@/lib/markting/ops/rate-limit-policy';

const ctx = (o: Partial<RateContext> = {}): RateContext => ({ organizationId: 'orgA', provider: 'meta', ...o });
const policy = (o: Partial<RatePolicy> = {}): RatePolicy => ({ capacity: 5, refillPerSec: 5, burst: 0, ...o });

describe('C.6-29 — scope keys', () => {
  it('GLOBAL is a single shared key; ORG_PROVIDER is org-qualified', () => {
    expect(rateScopeKey('GLOBAL', ctx())).toBe('GLOBAL');
    expect(rateScopeKey('ORG_PROVIDER', ctx())).toBe('orgA:meta');
    expect(rateScopeKey('ORG_PROVIDER', ctx({ organizationId: 'orgB' }))).toBe('orgB:meta');
  });
  it('one tenant/provider bucket never collides with another', () => {
    expect(rateScopeKey('ORG_PROVIDER', ctx({ provider: 'google' }))).not.toBe(rateScopeKey('ORG_PROVIDER', ctx()));
  });
});

describe('C.6-29 — token bucket decide()', () => {
  it('allows up to the ceiling then rejects with a retryAfterMs', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const p = policy({ capacity: 3, refillPerSec: 1, burst: 0 }); // ceiling 3
    expect(decide(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(true);
    expect(decide(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(true);
    const third = decide(store, clock, 'ORG_PROVIDER', ctx(), p);
    expect(third.allow).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = decide(store, clock, 'ORG_PROVIDER', ctx(), p);
    expect(fourth.allow).toBe(false);
    expect(fourth.remaining).toBe(0);
    // 1 token/sec → need 1s for the next token.
    expect(fourth.retryAfterMs).toBe(1000);
  });

  it('refills over time against the injected clock (deterministic)', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const p = policy({ capacity: 2, refillPerSec: 2, burst: 0 }); // 2 tokens/sec
    decide(store, clock, 'ORG_PROVIDER', ctx(), p);
    decide(store, clock, 'ORG_PROVIDER', ctx(), p);
    expect(decide(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(false);
    clock.advance(500); // 0.5s → +1 token
    const after = decide(store, clock, 'ORG_PROVIDER', ctx(), p);
    expect(after.allow).toBe(true);
  });

  it('never refills above the ceiling (capacity + burst)', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const p = policy({ capacity: 2, refillPerSec: 10, burst: 1 }); // ceiling 3
    decide(store, clock, 'ORG_PROVIDER', ctx(), p); // consume 1 → 2 left
    clock.advance(100_000); // huge idle; would overflow without the cap
    const d = peek(store, clock, 'ORG_PROVIDER', ctx(), p, 3);
    expect(d.allow).toBe(true); // exactly the ceiling of 3 is available
    expect(peek(store, clock, 'ORG_PROVIDER', ctx(), p, 4).allow).toBe(false);
  });

  it('supports a cost > 1 and reports the wait for the full deficit', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const p = policy({ capacity: 1, refillPerSec: 1, burst: 0 });
    const d = decide(store, clock, 'ORG_PROVIDER', ctx(), p, 3); // need 3, have 1 → deficit 2
    expect(d.allow).toBe(false);
    expect(d.retryAfterMs).toBe(2000);
  });

  it('peek() is non-mutating', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const p = policy({ capacity: 1, refillPerSec: 1, burst: 0 });
    expect(peek(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(true);
    expect(peek(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(true); // still allowed — nothing consumed
    expect(decide(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(true);
    expect(decide(store, clock, 'ORG_PROVIDER', ctx(), p).allow).toBe(false);
  });
});

describe('C.6-29 — scoped decision (most restrictive wins)', () => {
  it('rejects on GLOBAL without burning the ORG_PROVIDER bucket', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const global = policy({ capacity: 1, refillPerSec: 1, burst: 0 });
    const orgProvider = policy({ capacity: 10, refillPerSec: 10, burst: 0 });
    expect(decideScoped(store, clock, ctx(), { global, orgProvider }).allow).toBe(true); // uses the 1 global token
    const blocked = decideScoped(store, clock, ctx(), { global, orgProvider });
    expect(blocked.allow).toBe(false);
    // ORG_PROVIDER lost only the 1 token from the admitted request; the rejected one did not burn it.
    expect(peek(store, clock, 'ORG_PROVIDER', ctx(), orgProvider, 9).allow).toBe(true);
    expect(peek(store, clock, 'ORG_PROVIDER', ctx(), orgProvider, 10).allow).toBe(false);
  });

  it('rejects on ORG_PROVIDER without consuming GLOBAL', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    const global = policy({ capacity: 100, refillPerSec: 100, burst: 0 });
    const orgProvider = policy({ capacity: 1, refillPerSec: 1, burst: 0 });
    expect(decideScoped(store, clock, ctx(), { global, orgProvider }).allow).toBe(true);
    expect(decideScoped(store, clock, ctx(), { global, orgProvider }).allow).toBe(false);
    // GLOBAL only lost 1 (the admitted request), not 2.
    const g = store.get(rateScopeKey('GLOBAL', ctx())) as BucketState;
    expect(g.tokens).toBeCloseTo(99, 5);
  });
});

describe('C.6-29 — fixed/sliding window alternative', () => {
  it('allows up to max in a window, then rejects until it rolls over', () => {
    const store = new InMemoryCounterStore<WindowState>();
    const clock = new FakeClock(0);
    const wp = { windowMs: 1000, max: 2 };
    expect(decideWindow(store, clock, 'ORG_PROVIDER', ctx(), wp).allow).toBe(true);
    expect(decideWindow(store, clock, 'ORG_PROVIDER', ctx(), wp).allow).toBe(true);
    const blocked = decideWindow(store, clock, 'ORG_PROVIDER', ctx(), wp);
    expect(blocked.allow).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    clock.advance(1000); // new window
    expect(decideWindow(store, clock, 'ORG_PROVIDER', ctx(), wp).allow).toBe(true);
  });
});

describe('C.6-29 — default policy table (DOCUMENTATION_DERIVED)', () => {
  it('resolves a known provider and falls back for unknown', () => {
    expect(policyForProvider('meta')).toEqual(PROVIDER_RATE_POLICIES.meta);
    expect(policyForProvider('does-not-exist')).toEqual(DEFAULT_RATE_POLICY);
  });
  it('defaults are conservative positive ceilings', () => {
    for (const [, p] of Object.entries(PROVIDER_RATE_POLICIES)) {
      expect(p.capacity).toBeGreaterThan(0);
      expect(p.refillPerSec).toBeGreaterThan(0);
      expect(p.burst).toBeGreaterThanOrEqual(0);
      expect(policyCeiling(p)).toBeLessThanOrEqual(policyCeiling(DEFAULT_GLOBAL_POLICY));
    }
  });
});

describe('C.6-29 — RateLimiter convenience + executor compatibility', () => {
  it('throttles by context and yields a retryAfterMs the executor can honor', () => {
    const store = new InMemoryCounterStore<BucketState>();
    const clock = new FakeClock(0);
    // Tiny global so we hit the cap quickly regardless of provider policy.
    const limiter = new RateLimiter(store, clock, { capacity: 1, refillPerSec: 1, burst: 0 });
    expect(limiter.check(ctx()).allow).toBe(true);
    const d = limiter.check(ctx());
    expect(d.allow).toBe(false);
    // Shape matches ExecutorResult.retryAfterMs semantics: a finite ms wait.
    expect(typeof d.retryAfterMs).toBe('number');
    expect(d.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('C.6-29 — Postgres stub is a non-wired marker', () => {
  it('throws BLOCKED_EXTERNAL on use', () => {
    const stub = new PostgresCounterStoreStub<BucketState>();
    expect(() => stub.get('k')).toThrow(/BLOCKED_EXTERNAL/);
    expect(() => stub.set('k', { tokens: 1, updatedAtMs: 0 })).toThrow(/BLOCKED_EXTERNAL/);
  });
});
