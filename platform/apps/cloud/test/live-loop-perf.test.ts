import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows } from '@/lib/markting/intelligence/normalize';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { emptyBusinessContext } from '@/lib/markting/business-context';

/**
 * PHASE A (A9) — bounded, linear performance of the in-memory live loop. The gatherer computes
 * observations per request (no persistence, no per-row DB write → no N+1), so this asserts the compute
 * path scales linearly and never duplicates entities across 100 / 1,000 / 10,000 campaign rows.
 */
const PERIOD = { current: { start: '2026-09-28', end: '2026-10-04' }, previous: { start: '2026-09-21', end: '2026-09-27' } };

function rows(n: number, period: 'cur' | 'prev'): ReportRow[] {
  const conv = period === 'cur' ? 40 : 60;
  return Array.from({ length: n }, (_, i) => ({
    provider: 'meta', accountId: 'act_1', currency: 'USD',
    entity: { level: 'campaign' as const, id: `c${i}`, name: `Campaign ${i}` },
    metrics: { spend: 1000 + i, clicks: 200, conversions: conv, conversion_value: 3000 },
  }));
}

function normalize(r: ReportRow[], range: { start: string; end: string }) {
  return normalizeReportRows(r, { tier: 'PLATFORM_REPORTED', dateRange: range, windowComplete: true, readAt: '2026-10-04T06:00:00.000Z' });
}

describe.each([100, 1000, 10000])('live loop scales at %i campaigns', (n) => {
  it('completes within a bounded time and produces exactly n unique campaigns', () => {
    const cur = normalize(rows(n, 'cur'), PERIOD.current);
    const prev = normalize(rows(n, 'prev'), PERIOD.previous);
    const t0 = Date.now();
    const intel = analyzeAccount({
      engineContext: { organizationId: 'org', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD,
      currentAccount: cur, previousAccount: prev, currentCampaigns: cur, previousCampaigns: prev,
      business: emptyBusinessContext('org'),
    });
    const ms = Date.now() - t0;
    expect(intel.campaigns).toHaveLength(n);
    const ids = new Set(intel.campaigns.map((c) => c.entityId));
    expect(ids.size, 'no duplicate campaigns').toBe(n);
    // Generous linear-ish bound (10k well under this on CI); a quadratic regression would blow past it.
    expect(ms, `analyze ${n} campaigns in ${ms}ms`).toBeLessThan(n <= 1000 ? 2000 : 15000);
  });
});
