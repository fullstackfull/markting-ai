import 'server-only';
import type { ErrorClass } from './provider-executor';
import { ProviderSignal } from './provider-executor';
import { isBlockedExternal, type AICompletionRequest, type AIProviderAdapter } from './ai-provider-adapter';

/**
 * PHASE C.6 (33) — AI FAILOVER POLICY (deterministic, pure).
 *
 * A deterministic failover across a role's ordered, allowlisted provider adapters. Per-candidate it mirrors
 * the provider-executor classification: TRANSIENT -> try next, RATE_LIMIT -> backoff + next, AUTH/PERMANENT
 * -> stop. A per-provider CIRCUIT BREAKER (closed / half_open / open, the same vocabulary as the health
 * breaker) skips a provider whose breaker is open until a cooldown elapses, then trials it half_open. A
 * BLOCKED_EXTERNAL candidate (the credential-free real seam) is skipped WITHOUT tripping its breaker. When
 * every candidate is exhausted — or a stop class is hit — the outcome is DEGRADED via an injected local
 * fallback, or STOPPED when none is given. It NEVER fabricates a success. Pure over injected adapters +
 * clock; reports backoff as a number and sleeps nothing.
 */

export type BreakerState = 'closed' | 'half_open' | 'open';

export interface BreakerSnapshot {
  state: BreakerState;
  consecutiveFailures: number;
  openedAtMs?: number;
}

export interface BreakerConfig {
  /** Consecutive failures that trip a closed breaker to open. */
  failureThreshold: number;
  /** How long an open breaker waits before a half_open trial. */
  cooldownMs: number;
}

export const DEFAULT_BREAKER_CONFIG: BreakerConfig = { failureThreshold: 3, cooldownMs: 30_000 };

/** The breaker store (injected). Pure in-memory fake below; a durable store is out of scope here. */
export interface BreakerRegistry {
  get(provider: string): BreakerSnapshot;
  set(provider: string, snap: BreakerSnapshot): void;
}

export class InMemoryBreakerRegistry implements BreakerRegistry {
  private readonly m = new Map<string, BreakerSnapshot>();
  get(provider: string): BreakerSnapshot {
    return this.m.get(provider) ?? { state: 'closed', consecutiveFailures: 0 };
  }
  set(provider: string, snap: BreakerSnapshot): void {
    this.m.set(provider, snap);
  }
  snapshot(): Record<string, BreakerState> {
    const out: Record<string, BreakerState> = {};
    for (const [k, v] of this.m) out[k] = v.state;
    return out;
  }
}

export type AttemptOutcome =
  | 'SUCCESS'
  | 'TRANSIENT'
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'PERMANENT'
  | 'BLOCKED_EXTERNAL'
  | 'BREAKER_OPEN';

export interface FailoverAttempt {
  provider: string;
  outcome: AttemptOutcome;
  errorClass: ErrorClass;
  /** For RATE_LIMIT / TRANSIENT: the deterministic backoff reported to the scheduler (never slept here). */
  backoffMs?: number;
  evidence?: string;
}

export type FailoverStatus = 'OK' | 'DEGRADED_LOCAL_FALLBACK' | 'STOPPED';

export interface FailoverResult<T> {
  status: FailoverStatus;
  /** Present on OK (the served value) or DEGRADED (the local fallback value). Absent on STOPPED. */
  value?: T;
  /** The provider that served on OK. */
  servedBy?: string;
  attempts: FailoverAttempt[];
  localFallback: boolean;
  /** Breaker state per provider after the run. */
  breakerStates: Record<string, BreakerState>;
}

export interface FailoverOptions<T> {
  /** Ordered candidate adapters (already filtered to the role's allowlist by the caller). */
  candidates: ReadonlyArray<AIProviderAdapter>;
  request: AICompletionRequest;
  /** How to call a candidate. Defaults to `adapter.complete(request)`. */
  call?: (adapter: AIProviderAdapter, request: AICompletionRequest) => Promise<T>;
  breakers: BreakerRegistry;
  breakerConfig?: BreakerConfig;
  /** Monotonic clock (ms), injected for determinism. */
  now: () => number;
  /** Base backoff (ms) for exponential per-attempt backoff when no provider hint is given. */
  baseBackoffMs?: number;
  /** Produces the DEGRADED local-fallback value when candidates are exhausted or a stop class is hit. */
  localFallback?: () => T;
}

/** Map a thrown adapter error to a (class, outcome) — mirrors the executor's classification style. */
function classifyError(e: unknown): { errorClass: ErrorClass; outcome: AttemptOutcome; retryAfterMs?: number } {
  if (isBlockedExternal(e)) return { errorClass: 'PERMANENT', outcome: 'BLOCKED_EXTERNAL' };
  if (e instanceof ProviderSignal) {
    switch (e.kind) {
      case 'AUTH': return { errorClass: 'AUTH', outcome: 'AUTH' };
      case 'RATE_LIMIT': return { errorClass: 'RATE_LIMIT', outcome: 'RATE_LIMIT', retryAfterMs: e.retryAfterMs };
      case 'SCHEMA': return { errorClass: 'PERMANENT', outcome: 'PERMANENT' };
      case 'PERMANENT': return { errorClass: 'PERMANENT', outcome: 'PERMANENT' };
      case 'TRANSIENT': return { errorClass: 'TRANSIENT', outcome: 'TRANSIENT' };
    }
  }
  // An unclassified throw is treated as AMBIGUOUS/transient — try the next candidate, never blind success.
  return { errorClass: 'AMBIGUOUS', outcome: 'TRANSIENT' };
}

/** Record a breaker failure, tripping to open at the threshold (half_open failure re-opens immediately). */
function recordFailure(reg: BreakerRegistry, provider: string, cfg: BreakerConfig, now: number): void {
  const snap = reg.get(provider);
  if (snap.state === 'half_open') {
    reg.set(provider, { state: 'open', consecutiveFailures: snap.consecutiveFailures + 1, openedAtMs: now });
    return;
  }
  const failures = snap.consecutiveFailures + 1;
  reg.set(provider, failures >= cfg.failureThreshold
    ? { state: 'open', consecutiveFailures: failures, openedAtMs: now }
    : { state: 'closed', consecutiveFailures: failures });
}

/** Reset a breaker to closed on a success. */
function recordSuccess(reg: BreakerRegistry, provider: string): void {
  reg.set(provider, { state: 'closed', consecutiveFailures: 0 });
}

/**
 * Is this candidate admittable now? Returns the admitting state: 'closed'/'half_open' allow a call, an open
 * breaker past cooldown transitions to half_open (and allows a trial), an open breaker inside cooldown
 * returns null (skip).
 */
function admit(reg: BreakerRegistry, provider: string, cfg: BreakerConfig, now: number): BreakerState | null {
  const snap = reg.get(provider);
  if (snap.state !== 'open') return snap.state;
  if (snap.openedAtMs != null && now - snap.openedAtMs >= cfg.cooldownMs) {
    reg.set(provider, { state: 'half_open', consecutiveFailures: snap.consecutiveFailures, openedAtMs: snap.openedAtMs });
    return 'half_open';
  }
  return null;
}

function breakerStates(reg: BreakerRegistry, providers: ReadonlyArray<string>): Record<string, BreakerState> {
  const out: Record<string, BreakerState> = {};
  for (const p of providers) out[p] = reg.get(p).state;
  return out;
}

/** Deterministic exponential backoff for the Nth try (0-based), honoring a provider hint when present. */
function backoffFor(index: number, base: number, hint?: number): number {
  if (hint != null) return hint;
  return base * 2 ** index;
}

/**
 * Run the failover across the ordered candidates. Pure for a fixed clock + adapters + breaker store.
 */
export async function runAIFailover<T>(opts: FailoverOptions<T>): Promise<FailoverResult<T>> {
  const cfg = opts.breakerConfig ?? DEFAULT_BREAKER_CONFIG;
  const base = opts.baseBackoffMs ?? 500;
  const call = opts.call ?? ((a: AIProviderAdapter, r: AICompletionRequest) => a.complete(r) as unknown as Promise<T>);
  const providers = opts.candidates.map((c) => c.provider);
  const attempts: FailoverAttempt[] = [];
  let stopped = false;

  for (let i = 0; i < opts.candidates.length; i++) {
    const adapter = opts.candidates[i]!;
    const provider = adapter.provider;
    const now = opts.now();

    const admitting = admit(opts.breakers, provider, cfg, now);
    if (admitting == null) {
      attempts.push({ provider, outcome: 'BREAKER_OPEN', errorClass: 'TRANSIENT', evidence: 'breaker_open_cooldown' });
      continue;
    }

    try {
      const value = await call(adapter, opts.request);
      recordSuccess(opts.breakers, provider);
      attempts.push({ provider, outcome: 'SUCCESS', errorClass: 'NONE' });
      return { status: 'OK', value, servedBy: provider, attempts, localFallback: false, breakerStates: breakerStates(opts.breakers, providers) };
    } catch (e) {
      const { errorClass, outcome, retryAfterMs } = classifyError(e);

      // BLOCKED_EXTERNAL is a configuration state, not a fault: skip to next WITHOUT tripping the breaker.
      if (outcome === 'BLOCKED_EXTERNAL') {
        attempts.push({ provider, outcome, errorClass, evidence: 'blocked_external' });
        continue;
      }

      recordFailure(opts.breakers, provider, cfg, now);

      if (outcome === 'AUTH' || outcome === 'PERMANENT') {
        attempts.push({ provider, outcome, errorClass, evidence: outcome.toLowerCase() });
        stopped = true;
        break; // a stop class halts the whole failover — do not try further providers.
      }
      // RATE_LIMIT / TRANSIENT → report backoff, try the next candidate.
      attempts.push({ provider, outcome, errorClass, backoffMs: backoffFor(i, base, retryAfterMs), evidence: outcome.toLowerCase() });
    }
  }

  // Exhausted or stopped — DEGRADED local fallback if one is injected, else STOPPED. Never a fake success.
  const states = breakerStates(opts.breakers, providers);
  void stopped; // whether we halted on a stop class vs ran dry is visible in `attempts`.
  if (opts.localFallback) {
    return { status: 'DEGRADED_LOCAL_FALLBACK', value: opts.localFallback(), attempts, localFallback: true, breakerStates: states };
  }
  return { status: 'STOPPED', attempts, localFallback: false, breakerStates: states };
}
