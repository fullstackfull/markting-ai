import { describe, expect, it } from 'vitest';
import { generateObservations, SCALE_TIERS } from '@/lib/markting/orchestrator/scale-fixtures';
import { QUERY_BUDGETS, withinBudget } from '@/lib/markting/orchestrator/query-budgets';
import { buildAnalysisContext } from '@/lib/markting/intelligence/context';

/**
 * CODE-RC Programs 9/10/11 — scale fixtures, query budgets, and an in-memory performance harness.
 *
 * The precise p50/p95 of the DB read paths requires a running Postgres and is measured in the
 * RUN_PERF-gated CI job; here we (a) prove the fixture generator is deterministic, (b) assert the
 * query-budget invariant is well-formed and size-independent, and (c) characterize the in-memory
 * orchestrator context assembly at 100/1k/10k campaigns, reporting timings (RUN_PERF for the full tier).
 */
const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };

describe('Program 10 — deterministic scale fixtures', () => {
  it('generates N observations deterministically for a fixed seed', () => {
    const a = generateObservations(1000, { seed: 7 });
    const b = generateObservations(1000, { seed: 7 });
    expect(a.length).toBe(1000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // byte-identical across runs
    // different seed → different data (not all-identical rows)
    const c = generateObservations(1000, { seed: 8 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    // spend varies (realistic spread, not a constant)
    expect(new Set(a.map((o) => o.metrics.spend)).size).toBeGreaterThan(500);
  });
});

describe('Program 9 — query budgets are well-formed and size-independent', () => {
  it('every surface declares a positive, bounded budget with documented reads', () => {
    for (const b of Object.values(QUERY_BUDGETS)) {
      expect(b.maxQueries).toBeGreaterThan(0);
      expect(b.maxQueries).toBeLessThan(40); // a surface render is bounded, never hundreds
      expect(b.reads.length).toBeGreaterThan(0);
    }
  });
  it('withinBudget flags an over-budget (query-explosion) regression', () => {
    expect(withinBudget('workspace', QUERY_BUDGETS.workspace!.maxQueries)).toBe(true);
    expect(withinBudget('workspace', QUERY_BUDGETS.workspace!.maxQueries + 1)).toBe(false);
  });
});

describe('Program 11 — in-memory orchestrator context perf characterization', () => {
  const tiers = process.env.RUN_PERF === '1' ? SCALE_TIERS : ([100, 1_000] as const);
  it.each(tiers.map((n) => [n] as const))('assembles a bounded context for %i campaigns within budget time', (n) => {
    const current = generateObservations(n, { seed: 1, period: 'current' });
    const previous = generateObservations(n, { seed: 2, period: 'previous' });
    const t0 = Date.now();
    const ctx = buildAnalysisContext({
      organizationId: 'org-1', dataset: 'LIVE', period: PERIOD,
      currentAccount: [current[0]!], previousAccount: [previous[0]!],
      currentCampaigns: current, previousCampaigns: previous,
    });
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`PERF context@${n}: ${ms}ms, kept=${ctx.topCampaigns.length}, summarized=${ctx.summarizedCampaignCount}`);
    expect(ctx.topCampaigns.length).toBeLessThanOrEqual(10); // bounded regardless of n
    expect(ms).toBeLessThan(2000);
  });
});
