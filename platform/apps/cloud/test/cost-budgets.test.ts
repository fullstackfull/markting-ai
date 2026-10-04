import { describe, expect, it } from 'vitest';
import {
  recordAndCheck, toMetricPoints, budgetAlert, periodBucket, usageKey,
  DEFAULT_BUDGET_CONFIG, FakeClock, InMemoryUsageAccumulator, PostgresUsageAccumulatorStub, CostBudgetEngine,
  type BudgetConfig, type BudgetContext,
} from '@/lib/markting/ops/cost-budgets';

const tenant = (organizationId = 'orgA'): BudgetContext => ({ scope: 'TENANT', organizationId });
const global: BudgetContext = { scope: 'GLOBAL' };
const config = (o: Partial<BudgetConfig> = {}): BudgetConfig => ({ dailyMicros: 1_000, monthlyMicros: 10_000, warnPct: 0.8, ...o });

// A fixed instant in UTC for deterministic bucketing.
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15
const DAY_MS = 86_400_000;

describe('C.6-30 — period bucketing (UTC, deterministic)', () => {
  it('buckets by UTC day and month', () => {
    expect(periodBucket('DAY', T0)).toBe('2026-01-15');
    expect(periodBucket('MONTH', T0)).toBe('2026-01');
  });
  it('keys are org-qualified and scope-qualified', () => {
    expect(usageKey(tenant(), 'DAY', '2026-01-15')).toBe('org:orgA:DAY:2026-01-15');
    expect(usageKey(global, 'MONTH', '2026-01')).toBe('GLOBAL:MONTH:2026-01');
    expect(usageKey(tenant('orgB'), 'DAY', '2026-01-15')).not.toBe(usageKey(tenant('orgA'), 'DAY', '2026-01-15'));
  });
});

describe('C.6-30 — recordAndCheck state machine', () => {
  it('reports OK below the warn threshold', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    const r = recordAndCheck(acc, clock, tenant(), config(), 500); // 50% of daily
    expect(r.state).toBe('OK');
    expect(r.spent).toBe(500);
    expect(r.remaining).toBe(500);
    expect(r.pct).toBeCloseTo(0.5, 5);
    expect(r.hardStop).toBe(false);
  });

  it('crosses into WARN at the soft threshold', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    recordAndCheck(acc, clock, tenant(), config(), 500);
    const r = recordAndCheck(acc, clock, tenant(), config(), 300); // 800/1000 = 80%
    expect(r.state).toBe('WARN');
    expect(r.pct).toBeCloseTo(0.8, 5);
    expect(r.period).toBe('DAY');
  });

  it('BLOCKS and commits NOTHING when a spend would exceed the hard cap', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    recordAndCheck(acc, clock, tenant(), config(), 900); // 90% daily
    const blocked = recordAndCheck(acc, clock, tenant(), config(), 200); // would be 1100 > 1000
    expect(blocked.state).toBe('BLOCKED');
    expect(blocked.hardStop).toBe(true);
    expect(blocked.spent).toBe(900); // unchanged — the 200 was refused
    expect(blocked.remaining).toBe(100);
    // Accumulator still reflects only the admitted 900 — no silent overspend.
    expect(acc.get(usageKey(tenant(), 'DAY', periodBucket('DAY', T0)))).toBe(900);
  });

  it('allows a spend that exactly hits the cap (100%, not over)', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    const r = recordAndCheck(acc, clock, tenant(), config(), 1_000);
    expect(r.state).toBe('WARN'); // at 100%, still admitted (hard stop is >100%)
    expect(r.pct).toBeCloseTo(1, 5);
    expect(r.remaining).toBe(0);
    // One more micro is refused.
    expect(recordAndCheck(acc, clock, tenant(), config(), 1).state).toBe('BLOCKED');
  });

  it('the monthly window can bind even when the day is fine', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    const cfg = config({ dailyMicros: 10_000, monthlyMicros: 1_000 }); // monthly tighter than daily
    const r2 = recordAndCheck(acc, clock, tenant(), cfg, 900);
    expect(r2.period).toBe('MONTH');
    expect(r2.state).toBe('WARN'); // 900/1000 monthly = 90%
    const blocked = recordAndCheck(acc, clock, tenant(), cfg, 200); // monthly would exceed
    expect(blocked.state).toBe('BLOCKED');
    expect(blocked.period).toBe('MONTH');
  });

  it('spend in different UTC days falls in separate daily buckets but the same month', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    const cfg = config({ dailyMicros: 1_000, monthlyMicros: 10_000 });
    recordAndCheck(acc, clock, tenant(), cfg, 1_000); // fills day 1
    clock.advance(DAY_MS); // next UTC day
    const nextDay = recordAndCheck(acc, clock, tenant(), cfg, 1_000); // fresh daily bucket
    expect(nextDay.hardStop).toBe(false);
    // Monthly now at 2000/10000.
    expect(acc.get(usageKey(tenant(), 'MONTH', periodBucket('MONTH', clock.now())))).toBe(2_000);
  });

  it('tenants are isolated', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    recordAndCheck(acc, clock, tenant('orgA'), config(), 1_000);
    const other = recordAndCheck(acc, clock, tenant('orgB'), config(), 500);
    expect(other.state).toBe('OK'); // orgB unaffected by orgA
  });

  it('rejects a negative spend', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    expect(() => recordAndCheck(acc, clock, tenant(), config(), -1)).toThrow();
  });
});

describe('C.6-30 — observability bridge', () => {
  it('emits ai_cost_micros + tenant_usage MetricPoints', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    const r = recordAndCheck(acc, clock, tenant(), config(), 500);
    const points = toMetricPoints(r, tenant(), clock, 500);
    const names = points.map((p) => p.name).sort();
    expect(names).toEqual(['ai_cost_micros', 'tenant_usage']);
    const cost = points.find((p) => p.name === 'ai_cost_micros')!;
    expect(cost.value).toBe(500);
    expect(cost.organizationId).toBe('orgA');
    expect(cost.at).toBe(new Date(T0).toISOString());
    const usage = points.find((p) => p.name === 'tenant_usage')!;
    expect(usage.value).toBe(500);
    expect(usage.labels?.state).toBe('OK');
  });

  it('WARN maps to high_ai_cost; BLOCKED maps to quota_exhausted; OK → null', () => {
    const acc = new InMemoryUsageAccumulator();
    const clock = new FakeClock(T0);
    expect(budgetAlert(recordAndCheck(acc, clock, tenant(), config(), 500), tenant(), clock)).toBeNull();
    const warn = recordAndCheck(acc, clock, tenant(), config(), 400); // → 900/1000 = 90% WARN
    const warnAlert = budgetAlert(warn, tenant(), clock)!;
    expect(warnAlert.rule).toBe('high_ai_cost');
    const blocked = recordAndCheck(acc, clock, tenant(), config(), 500); // would exceed
    const blockedAlert = budgetAlert(blocked, tenant(), clock)!;
    expect(blockedAlert.rule).toBe('quota_exhausted');
    expect(blockedAlert.key).toContain('orgA');
  });
});

describe('C.6-30 — CostBudgetEngine convenience', () => {
  it('records by context alone and enforces the hard stop', () => {
    const engine = new CostBudgetEngine(new InMemoryUsageAccumulator(), new FakeClock(T0), config({ dailyMicros: 100, monthlyMicros: 1_000 }));
    expect(engine.record(tenant(), 100).state).toBe('WARN');
    expect(engine.record(tenant(), 1).state).toBe('BLOCKED');
  });
  it('default config is sane (warn < 100% of positive caps)', () => {
    expect(DEFAULT_BUDGET_CONFIG.warnPct).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET_CONFIG.warnPct).toBeLessThan(1);
    expect(DEFAULT_BUDGET_CONFIG.dailyMicros).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET_CONFIG.monthlyMicros).toBeGreaterThan(0);
  });
});

describe('C.6-30 — Postgres stub is a non-wired marker', () => {
  it('throws BLOCKED_EXTERNAL on use', () => {
    const stub = new PostgresUsageAccumulatorStub();
    expect(() => stub.get('k')).toThrow(/BLOCKED_EXTERNAL/);
    expect(() => stub.add('k', 1)).toThrow(/BLOCKED_EXTERNAL/);
  });
});
