import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { buildMorningBrief } from '@/lib/markting/intelligence/brief';
import { emptyBusinessContext } from '@/lib/markting/business-context';

// Performance characterization. Gated off CI (RUN_PERF=1) so it never slows the pipeline; it exists to
// produce the numbers in the exit report and to assert the account analysis is not O(N^2).
const describePerf = process.env.RUN_PERF === '1' ? describe : describe.skip;

const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, readAt: '2026-09-15T00:00:00Z', ...over };
}
function campaigns(n: number, dr = PERIOD.current): ReportRow[] {
  return Array.from({ length: n }, (_, i) => ({
    provider: 'meta', accountId: 'act_1', currency: 'SAR',
    entity: { level: 'campaign' as const, id: `c${i}`, name: `Campaign ${i}` },
    metrics: { spend: 100 + (i % 50), impressions: 10000, clicks: 300, conversions: 30 + (i % 10), conversion_value: 900 + i } as ReportRow['metrics'],
  }));
}

describePerf('Phase 2 performance (RUN_PERF=1)', () => {
  for (const n of [10, 100, 1000, 10000]) {
    it(`analyzeAccount + brief at ${n} campaigns`, () => {
      const business = emptyBusinessContext('o');
      const cur = normalizeReportRows(campaigns(n), ctx());
      const prev = normalizeReportRows(campaigns(n, PERIOD.previous), ctx({ dateRange: PERIOD.previous }));
      const acc = normalizeReportRows([{ provider: 'meta', accountId: 'act_1', currency: 'SAR', entity: { level: 'account', id: 'acc', name: 'Account' }, metrics: { spend: 100 * n, impressions: 10000 * n, clicks: 300 * n, conversions: 30 * n, conversion_value: 900 * n } as ReportRow['metrics'] }], ctx());
      const accP = normalizeReportRows([{ provider: 'meta', accountId: 'act_1', currency: 'SAR', entity: { level: 'account', id: 'acc', name: 'Account' }, metrics: { spend: 100 * n, impressions: 10000 * n, clicks: 300 * n, conversions: 28 * n, conversion_value: 950 * n } as ReportRow['metrics'] }], ctx({ dateRange: PERIOD.previous }));
      const t0 = performance.now();
      const intel = analyzeAccount({ engineContext: { organizationId: 'o', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD, currentAccount: acc, previousAccount: accP, currentCampaigns: cur, previousCampaigns: prev, business });
      const tAnalyze = performance.now() - t0;
      const t1 = performance.now();
      const brief = buildMorningBrief(intel);
      const tBrief = performance.now() - t1;
      const payloadKb = Math.round(JSON.stringify(brief).length / 1024);
      // eslint-disable-next-line no-console
      console.log(`n=${n}: analyze=${tAnalyze.toFixed(1)}ms brief=${tBrief.toFixed(1)}ms recs=${intel.recommendations.length} briefPayload=${payloadKb}KB`);
      expect(intel.campaigns.length).toBe(n);
    });
  }
});
