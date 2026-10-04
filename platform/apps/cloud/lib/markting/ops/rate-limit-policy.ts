import 'server-only';

/**
 * PHASE C.6 (29) — RATE-LIMIT POLICY ENGINE.
 *
 * A deterministic, PURE rate-limit policy engine a provider read loop can honor. The decision math is a
 * token bucket (with an optional fixed/sliding-window alternative) evaluated over an INJECTED clock + an
 * INJECTED counter store — no wall-clock, no network, no DB. A `decide()` returns
 * `{ allow, retryAfterMs?, remaining }`, shaped to drive the provider executor's RATE_LIMITED /
 * retryAfterMs path (see provider-executor.ts): allow → proceed, !allow → treat as RATE_LIMITED and wait
 * `retryAfterMs`. Scopes are GLOBAL and per-(organizationId, provider). Per-provider defaults are
 * DOCUMENTATION_DERIVED and intentionally CONSERVATIVE (a ceiling that protects the provider, not a
 * provider-advertised quota). A Postgres-backed counter store is an optional, clearly-marked stub.
 */

// ---- scopes ----
export const RATE_SCOPES = ['GLOBAL', 'ORG_PROVIDER'] as const;
export type RateScope = (typeof RATE_SCOPES)[number];

export interface RateContext {
  organizationId: string;
  provider: string;
}

/** The canonical counter key for a scope. ORG_PROVIDER is org-qualified so tenants never collide. */
export function rateScopeKey(scope: RateScope, ctx: RateContext): string {
  return scope === 'GLOBAL' ? 'GLOBAL' : `${ctx.organizationId}:${ctx.provider}`;
}

// ---- policy config ----
export interface RatePolicy {
  /** Steady-state bucket size (sustained concurrency of requests). */
  capacity: number;
  /** Tokens replenished per second (the sustained request rate). */
  refillPerSec: number;
  /** Extra headroom ABOVE capacity for short bursts; the bucket never exceeds capacity + burst. */
  burst: number;
}

/** The absolute bucket ceiling (capacity + burst). */
export function policyCeiling(p: RatePolicy): number {
  return p.capacity + p.burst;
}

// ---- deterministic clock (injected) ----
export interface Clock {
  now(): number;
}

/** A controllable clock for tests — pure, no wall-clock read. */
export class FakeClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

// ---- counter store port (injected) ----
export interface CounterStore<S> {
  get(key: string): S | undefined;
  set(key: string, state: S): void;
}

/** The in-memory fake store used by the engine and tests — no durability, no I/O. */
export class InMemoryCounterStore<S> implements CounterStore<S> {
  private readonly m = new Map<string, S>();
  get(key: string): S | undefined {
    return this.m.get(key);
  }
  set(key: string, state: S): void {
    this.m.set(key, state);
  }
  clear(): void {
    this.m.clear();
  }
  size(): number {
    return this.m.size;
  }
}

/**
 * BLOCKED_EXTERNAL stub — a durable Postgres-backed counter store is NOT wired (no DB in this
 * environment). It exists only to document the seam; every method throws so it can never be used to make
 * a silent live call. Production would implement this against an atomic UPSERT on a `markting_rate_buckets`
 * row. Tests never touch it (they inject InMemoryCounterStore).
 */
export class PostgresCounterStoreStub<S> implements CounterStore<S> {
  get(_key: string): S | undefined {
    throw new Error('BLOCKED_EXTERNAL: Postgres rate counter store not wired (no DB/credentials)');
  }
  set(_key: string, _state: S): void {
    throw new Error('BLOCKED_EXTERNAL: Postgres rate counter store not wired (no DB/credentials)');
  }
}

// ---- token-bucket decision ----
export interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export interface RateDecision {
  allow: boolean;
  /** When !allow: ms to wait before `cost` tokens will have refilled (drives executor retryAfterMs). */
  retryAfterMs?: number;
  /** Whole tokens left in the bucket after this decision. */
  remaining: number;
}

/** Refill a bucket to `now`, capped at the ceiling. Pure (returns a fresh state). */
function refill(state: BucketState, policy: RatePolicy, now: number): BucketState {
  const ceiling = policyCeiling(policy);
  const elapsedMs = Math.max(0, now - state.updatedAtMs);
  const added = (elapsedMs / 1000) * policy.refillPerSec;
  return { tokens: Math.min(ceiling, state.tokens + added), updatedAtMs: now };
}

/**
 * Decide whether `cost` tokens may be consumed in the given scope. PURE over the injected store + clock:
 * reads the bucket (or seeds a full one), refills by elapsed time, and either consumes + allows or rejects
 * with the exact wait until enough tokens exist. Deterministic for a fixed clock + store.
 */
export function decide(
  store: CounterStore<BucketState>,
  clock: Clock,
  scope: RateScope,
  ctx: RateContext,
  policy: RatePolicy,
  cost = 1,
): RateDecision {
  const key = rateScopeKey(scope, ctx);
  const now = clock.now();
  const ceiling = policyCeiling(policy);
  const prev = store.get(key) ?? { tokens: ceiling, updatedAtMs: now };
  const cur = refill(prev, policy, now);

  if (cur.tokens + 1e-9 >= cost) {
    const next: BucketState = { tokens: cur.tokens - cost, updatedAtMs: now };
    store.set(key, next);
    return { allow: true, remaining: Math.floor(next.tokens + 1e-9) };
  }
  // Not enough tokens — persist the refilled (not consumed) state and advise the wait.
  store.set(key, cur);
  const deficit = cost - cur.tokens;
  const retryAfterMs = policy.refillPerSec > 0 ? Math.ceil((deficit / policy.refillPerSec) * 1000) : Number.POSITIVE_INFINITY;
  return { allow: false, retryAfterMs, remaining: Math.floor(cur.tokens + 1e-9) };
}

/**
 * Decide across GLOBAL and ORG_PROVIDER scopes together: the MOST restrictive wins. A reject never
 * consumes the other scope's tokens — GLOBAL is checked first and, if it rejects, ORG_PROVIDER is left
 * untouched (and vice-versa), so a throttled request does not burn quota it could not use.
 */
export function decideScoped(
  store: CounterStore<BucketState>,
  clock: Clock,
  ctx: RateContext,
  policies: { global: RatePolicy; orgProvider: RatePolicy },
  cost = 1,
): RateDecision {
  // Peek GLOBAL without consuming, then peek ORG_PROVIDER; only consume both when both admit.
  const g = peek(store, clock, 'GLOBAL', ctx, policies.global, cost);
  if (!g.allow) return g;
  const o = peek(store, clock, 'ORG_PROVIDER', ctx, policies.orgProvider, cost);
  if (!o.allow) return o;
  // Both admit → commit both consumptions.
  decide(store, clock, 'GLOBAL', ctx, policies.global, cost);
  const committed = decide(store, clock, 'ORG_PROVIDER', ctx, policies.orgProvider, cost);
  return { allow: true, remaining: Math.min(g.remaining, committed.remaining) };
}

/** Non-mutating view of what `decide` would return (refills a scratch copy, never writes the store). */
export function peek(
  store: CounterStore<BucketState>,
  clock: Clock,
  scope: RateScope,
  ctx: RateContext,
  policy: RatePolicy,
  cost = 1,
): RateDecision {
  const key = rateScopeKey(scope, ctx);
  const now = clock.now();
  const ceiling = policyCeiling(policy);
  const cur = refill(store.get(key) ?? { tokens: ceiling, updatedAtMs: now }, policy, now);
  if (cur.tokens + 1e-9 >= cost) return { allow: true, remaining: Math.floor(cur.tokens + 1e-9) };
  const deficit = cost - cur.tokens;
  const retryAfterMs = policy.refillPerSec > 0 ? Math.ceil((deficit / policy.refillPerSec) * 1000) : Number.POSITIVE_INFINITY;
  return { allow: false, retryAfterMs, remaining: Math.floor(cur.tokens + 1e-9) };
}

// ---- optional fixed/sliding-window alternative ----
export interface WindowState {
  windowStartMs: number;
  count: number;
}

export interface WindowPolicy {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests permitted within one window. */
  max: number;
}

/**
 * A fixed-window limiter (the sliding-window alternative to the token bucket). PURE over the injected
 * store + clock. Resets the counter when the window rolls over; rejects with the ms until the current
 * window ends. Useful for providers that publish an "N requests per fixed interval" quota.
 */
export function decideWindow(
  store: CounterStore<WindowState>,
  clock: Clock,
  scope: RateScope,
  ctx: RateContext,
  policy: WindowPolicy,
): RateDecision {
  const key = rateScopeKey(scope, ctx);
  const now = clock.now();
  const prev = store.get(key);
  const windowStartMs = prev && now - prev.windowStartMs < policy.windowMs ? prev.windowStartMs : now;
  const count = prev && windowStartMs === prev.windowStartMs ? prev.count : 0;

  if (count < policy.max) {
    store.set(key, { windowStartMs, count: count + 1 });
    return { allow: true, remaining: policy.max - (count + 1) };
  }
  store.set(key, { windowStartMs, count });
  const retryAfterMs = Math.max(1, policy.windowMs - (now - windowStartMs));
  return { allow: false, retryAfterMs, remaining: 0 };
}

// ---- DOCUMENTATION_DERIVED default policy table ----
/**
 * Conservative per-provider defaults. These are PROTECTIVE ceilings (keep our read loop well under any
 * plausible provider limit), NOT provider-advertised quotas — tuned down deliberately. Unknown providers
 * and the GLOBAL scope fall back to DEFAULT_RATE_POLICY / DEFAULT_GLOBAL_POLICY.
 */
export const DEFAULT_RATE_POLICY: RatePolicy = { capacity: 5, refillPerSec: 5, burst: 5 };
export const DEFAULT_GLOBAL_POLICY: RatePolicy = { capacity: 50, refillPerSec: 50, burst: 50 };

export const PROVIDER_RATE_POLICIES: Record<string, RatePolicy> = {
  // Paid-media providers — conservative sustained rates with small bursts.
  google: { capacity: 8, refillPerSec: 8, burst: 4 },
  meta: { capacity: 10, refillPerSec: 10, burst: 5 },
  tiktok: { capacity: 6, refillPerSec: 6, burst: 3 },
  microsoft: { capacity: 6, refillPerSec: 6, burst: 3 },
  reddit: { capacity: 4, refillPerSec: 4, burst: 2 },
  apple: { capacity: 4, refillPerSec: 4, burst: 2 },
  snapchat: { capacity: 5, refillPerSec: 5, burst: 2 },
  spotify: { capacity: 4, refillPerSec: 4, burst: 2 },
  pinterest: { capacity: 5, refillPerSec: 5, burst: 2 },
  linkedin: { capacity: 5, refillPerSec: 5, burst: 2 },
  x: { capacity: 3, refillPerSec: 3, burst: 2 },
  // Commerce connectors — read-only sync; kept gentle.
  salla: { capacity: 3, refillPerSec: 3, burst: 2 },
  zid: { capacity: 3, refillPerSec: 3, burst: 2 },
  shopify: { capacity: 4, refillPerSec: 4, burst: 2 },
  woocommerce: { capacity: 3, refillPerSec: 3, burst: 2 },
  custom: { capacity: 2, refillPerSec: 2, burst: 1 },
};

/** Resolve the ORG_PROVIDER policy for a provider, falling back to the conservative default. */
export function policyForProvider(provider: string): RatePolicy {
  return PROVIDER_RATE_POLICIES[provider] ?? DEFAULT_RATE_POLICY;
}

// ---- convenience engine ----
/**
 * Bundles a store + clock + policy table so a caller can throttle by context alone. Stateless beyond the
 * injected store; two engines sharing a store share quota. Still pure/deterministic for a fixed clock.
 */
export class RateLimiter {
  constructor(
    private readonly store: CounterStore<BucketState>,
    private readonly clock: Clock,
    private readonly globalPolicy: RatePolicy = DEFAULT_GLOBAL_POLICY,
  ) {}

  /** Throttle a request for `ctx`, honoring both GLOBAL and the provider's ORG_PROVIDER policy. */
  check(ctx: RateContext, cost = 1): RateDecision {
    return decideScoped(this.store, this.clock, ctx, { global: this.globalPolicy, orgProvider: policyForProvider(ctx.provider) }, cost);
  }
}
