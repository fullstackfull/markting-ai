import 'server-only';
import type { MetricPoint } from './observability';
import type { Alert, AlertRule } from './observability';

/**
 * PHASE C.6 (30) — COST BUDGET ENGINE (micros).
 *
 * A deterministic, PURE per-tenant + GLOBAL spend-budget engine denominated in MICROS, aligned with the
 * observability `ai_cost_micros` / `tenant_usage` metrics. A budget has a daily + monthly cap, a soft WARN
 * threshold (percentage of cap), and a HARD STOP at 100%. `recordAndCheck(spendMicros)` is ADMISSION
 * CONTROL: it refuses — and does NOT commit — a spend that would cross the hard cap on any window, so a
 * caller can never silently overspend. It evaluates over an INJECTED usage accumulator (in-memory fake)
 * and an INJECTED clock — no wall-clock, no network, no DB. A Postgres-backed accumulator is an optional,
 * clearly-marked stub.
 */

export type BudgetScope = 'GLOBAL' | 'TENANT';
export type BudgetState = 'OK' | 'WARN' | 'BLOCKED';
export type BudgetPeriod = 'DAY' | 'MONTH';

export interface BudgetConfig {
  /** Daily hard cap in micros (hard stop at 100%). */
  dailyMicros: number;
  /** Monthly hard cap in micros (hard stop at 100%). */
  monthlyMicros: number;
  /** Soft alert threshold as a fraction in (0,1]; crossing it (but under 100%) yields WARN. */
  warnPct: number;
}

/** Conservative default: WARN at 80% of cap. */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = { dailyMicros: 5_000_000, monthlyMicros: 100_000_000, warnPct: 0.8 };

export interface BudgetContext {
  scope: BudgetScope;
  /** Required for TENANT scope; ignored for GLOBAL. */
  organizationId?: string;
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

// ---- period bucketing (UTC, locale-free, deterministic) ----
/** The UTC calendar bucket a timestamp falls in: 'YYYY-MM-DD' for DAY, 'YYYY-MM' for MONTH. */
export function periodBucket(period: BudgetPeriod, epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  if (period === 'MONTH') return `${y}-${m}`;
  return `${y}-${m}-${d.getUTCDate().toString().padStart(2, '0')}`;
}

/** The accumulator key for a (scope, org, period, bucket) — org-qualified so tenants never collide. */
export function usageKey(ctx: BudgetContext, period: BudgetPeriod, bucket: string): string {
  const owner = ctx.scope === 'GLOBAL' ? 'GLOBAL' : `org:${ctx.organizationId ?? ''}`;
  return `${owner}:${period}:${bucket}`;
}

// ---- usage accumulator port (injected) ----
export interface UsageAccumulator {
  /** Micros spent in the window (0 when unseen). */
  get(key: string): number;
  /** Add micros and return the new total (commit). */
  add(key: string, micros: number): number;
}

/** The in-memory fake accumulator used by the engine and tests — no durability, no I/O. */
export class InMemoryUsageAccumulator implements UsageAccumulator {
  private readonly m = new Map<string, number>();
  get(key: string): number {
    return this.m.get(key) ?? 0;
  }
  add(key: string, micros: number): number {
    const next = this.get(key) + micros;
    this.m.set(key, next);
    return next;
  }
  clear(): void {
    this.m.clear();
  }
}

/**
 * BLOCKED_EXTERNAL stub — a durable Postgres-backed accumulator is NOT wired (no DB in this environment).
 * It documents the seam only; every method throws so no silent live call is possible. Production would
 * implement `add` as an atomic `INSERT ... ON CONFLICT DO UPDATE SET spent = spent + $micros RETURNING
 * spent` on a `markting_cost_usage` row. Tests inject InMemoryUsageAccumulator instead.
 */
export class PostgresUsageAccumulatorStub implements UsageAccumulator {
  get(_key: string): number {
    throw new Error('BLOCKED_EXTERNAL: Postgres cost accumulator not wired (no DB/credentials)');
  }
  add(_key: string, _micros: number): number {
    throw new Error('BLOCKED_EXTERNAL: Postgres cost accumulator not wired (no DB/credentials)');
  }
}

// ---- decision ----
export interface BudgetResult {
  state: BudgetState;
  /** Spent micros in the BINDING window (the window with the highest utilization) AFTER this call. */
  spent: number;
  /** Remaining micros to the hard cap in the binding window (never negative). */
  remaining: number;
  /** Utilization of the binding window as a fraction (0..1+, clamped at the cap when committed). */
  pct: number;
  /** The window that bound the decision (highest utilization / the one that blocked). */
  period: BudgetPeriod;
  /** True when this spend was REFUSED (not committed) — the caller must not spend. */
  hardStop: boolean;
}

interface WindowEval {
  period: BudgetPeriod;
  key: string;
  limit: number;
  before: number;
  prospective: number;
  wouldExceed: boolean;
}

function evalWindow(acc: UsageAccumulator, ctx: BudgetContext, period: BudgetPeriod, now: number, limit: number, spend: number): WindowEval {
  const key = usageKey(ctx, period, periodBucket(period, now));
  const before = acc.get(key);
  const prospective = before + spend;
  return { period, key, limit, before, prospective, wouldExceed: prospective > limit };
}

/**
 * Record a spend and report the resulting budget state — ADMISSION CONTROL over BOTH the daily and monthly
 * windows. If admitting `spendMicros` would exceed EITHER hard cap, the spend is REFUSED (committed to
 * NOTHING) and the result is BLOCKED/hardStop, so the caller declines further spend. Otherwise the spend
 * is committed to both windows and the result reflects the binding (most-utilized) window: WARN once it is
 * at/over `warnPct`, else OK. PURE/deterministic for a fixed clock + accumulator.
 */
export function recordAndCheck(
  acc: UsageAccumulator,
  clock: Clock,
  ctx: BudgetContext,
  config: BudgetConfig,
  spendMicros: number,
): BudgetResult {
  if (spendMicros < 0) throw new Error('spendMicros must be >= 0');
  const now = clock.now();
  const windows = [
    evalWindow(acc, ctx, 'DAY', now, config.dailyMicros, spendMicros),
    evalWindow(acc, ctx, 'MONTH', now, config.monthlyMicros, spendMicros),
  ];

  // Hard stop: if any window would exceed its cap, refuse and commit nothing.
  const blocker = windows.find((w) => w.wouldExceed);
  if (blocker) {
    const pct = blocker.limit > 0 ? blocker.before / blocker.limit : 1;
    return {
      state: 'BLOCKED',
      spent: blocker.before,
      remaining: Math.max(0, blocker.limit - blocker.before),
      pct,
      period: blocker.period,
      hardStop: true,
    };
  }

  // Admitted — commit to every window.
  for (const w of windows) acc.add(w.key, spendMicros);

  // The binding window is the most-utilized after commit.
  const scored = windows
    .map((w) => ({ w, after: w.prospective, pct: w.limit > 0 ? w.prospective / w.limit : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const top = scored[0]!;
  const state: BudgetState = top.pct >= config.warnPct ? 'WARN' : 'OK';
  return {
    state,
    spent: top.after,
    remaining: Math.max(0, top.w.limit - top.after),
    pct: top.pct,
    period: top.w.period,
    hardStop: false,
  };
}

// ---- observability bridge ----
/**
 * Emit the usage as observability MetricPoints: the spend as `ai_cost_micros` and the cumulative binding
 * window total as `tenant_usage`. Labels carry the period + scope + resulting state (secret-free).
 */
export function toMetricPoints(result: BudgetResult, ctx: BudgetContext, clock: Clock, spendMicros: number): MetricPoint[] {
  const at = new Date(clock.now()).toISOString();
  const organizationId = ctx.scope === 'TENANT' ? ctx.organizationId : undefined;
  const labels: Record<string, string> = { scope: ctx.scope, period: result.period, state: result.state };
  return [
    { name: 'ai_cost_micros', value: spendMicros, organizationId, labels, at },
    { name: 'tenant_usage', value: result.spent, organizationId, labels: { ...labels, pct: result.pct.toFixed(4) }, at },
  ];
}

/**
 * Map a budget result to an alert-worthy signal, or null when OK. WARN → 'high_ai_cost' (soft, dedupe-able
 * notice); BLOCKED → 'quota_exhausted' (hard stop). Both rules exist in observability.ALERT_RULES.
 */
export function budgetAlert(result: BudgetResult, ctx: BudgetContext, clock: Clock): Alert | null {
  if (result.state === 'OK') return null;
  const rule: AlertRule = result.state === 'BLOCKED' ? 'quota_exhausted' : 'high_ai_cost';
  const key = ctx.scope === 'TENANT' ? `${ctx.organizationId ?? ''}:${result.period}` : `GLOBAL:${result.period}`;
  const pct = (result.pct * 100).toFixed(1);
  return {
    rule,
    key,
    message: result.state === 'BLOCKED'
      ? `${ctx.scope} ${result.period} budget hard stop at ${pct}% — spend refused`
      : `${ctx.scope} ${result.period} budget at ${pct}% (warn threshold crossed)`,
    at: new Date(clock.now()).toISOString(),
  };
}

// ---- convenience engine ----
/**
 * Bundles an accumulator + clock + config so a caller can record spend by context alone. Stateless beyond
 * the injected accumulator; still pure/deterministic for a fixed clock.
 */
export class CostBudgetEngine {
  constructor(
    private readonly acc: UsageAccumulator,
    private readonly clock: Clock,
    private readonly config: BudgetConfig = DEFAULT_BUDGET_CONFIG,
  ) {}

  /** Admission-controlled record+check for a spend in the given scope. */
  record(ctx: BudgetContext, spendMicros: number): BudgetResult {
    return recordAndCheck(this.acc, this.clock, ctx, this.config, spendMicros);
  }
}
