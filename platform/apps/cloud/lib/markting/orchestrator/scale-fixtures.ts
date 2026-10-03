import type { MetricObservation } from '../intelligence/model';

/**
 * CODE-RC Program 10 — deterministic, generated scale fixtures (no giant committed files).
 *
 * `generateObservations(n, seed)` produces N campaign-level MetricObservations with a deterministic,
 * seed-driven spread of spend/conversions so a scale/perf harness exercises realistic ranking and
 * aggregation (not all-identical rows). The same generator feeds the in-memory orchestrator scale test
 * and the (RUN_PERF-gated) DB performance harness, so both measure the same shaped data.
 */
const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };

/** A tiny deterministic LCG so fixtures are byte-identical across runs without committing data. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function generateObservations(n: number, opts: { seed?: number; period?: 'current' | 'previous'; currency?: string } = {}): MetricObservation[] {
  const rand = lcg(opts.seed ?? 42);
  const range = PERIOD[opts.period ?? 'current'];
  const currency = opts.currency ?? 'SAR';
  const out: MetricObservation[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const spend = Math.round((500 + rand() * 9500) * 100) / 100;
    const clicks = Math.round(50 + rand() * 950);
    const impressions = clicks * Math.round(10 + rand() * 40);
    const conversions = Math.round(clicks * (0.01 + rand() * 0.08));
    const id = `gen:camp:${i}`;
    out[i] = {
      provider: 'meta', accountId: 'gen:acc',
      entity: { level: 'campaign', id, rawId: String(i), name: `Generated campaign ${i}`, sourceProvider: 'meta', accountId: 'gen:acc' },
      dateRange: range, currency, timezone: 'Asia/Riyadh',
      trust: { tier: 'PLATFORM_REPORTED', source: 'aggregate' },
      metrics: { spend, clicks, impressions, conversions, conversion_value: Math.round(spend * (1 + rand() * 4) * 100) / 100 },
    };
  }
  return out;
}

/** Scale tiers the harness/tests use, matching the mission's fixture sizes. */
export const SCALE_TIERS = [100, 1_000, 10_000] as const;
