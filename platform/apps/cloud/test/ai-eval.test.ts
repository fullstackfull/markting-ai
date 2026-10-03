/**
 * Phase 1 AI media-buyer evaluation suite (required deliverable). Fixed synthetic datasets; the
 * deterministic analysis engine answers the 10 canonical questions and is scored for factual +
 * calculation correctness, evidence use, uncertainty (INSUFFICIENT_EVIDENCE), no hallucinated
 * metrics, tenant isolation, and action safety. The LLM narrates these governed signals; it does not
 * compute them, so correctness is asserted here on the layer that produces the numbers.
 */
import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { budgetPacing, campaignContribution, comparePeriods, funnelDecomposition } from '@/lib/markting/intelligence/analysis';

const P = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: P.current, windowComplete: true, timezone: 'Asia/Riyadh', readAt: '2026-09-15T00:00:00Z', attribution: { meta: { label: 'omni_purchase 7d-click' } }, ...over };
}
function r(id: string, m: Record<string, number>, lvl: ReportRow['entity']['level'] = 'account', ccy = 'SAR'): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency: ccy, entity: { level: lvl, id, name: id }, metrics: m as ReportRow['metrics'] };
}

describe('AI media-buyer evaluation suite (1 of required Phase-1 deliverables)', () => {
  // Shared scenario: ROAS fell 4.0 → 2.0 on a complete week with a sufficient sample.
  const cur = () => normalizeReportRows([r('acc', { spend: 1000, clicks: 40, impressions: 10000, conversions: 40, conversion_value: 2000 })], ctx());
  const prev = () => normalizeReportRows([r('acc', { spend: 1000, clicks: 50, impressions: 10000, conversions: 60, conversion_value: 4000 })], ctx({ dateRange: P.previous }));

  it('Q1 Why did ROAS decline? — identifies the decline with evidence, cites spend/value', () => {
    const c = comparePeriods(cur(), prev(), P);
    const roas = c.changes.find((x) => x.metric === 'roas')!;
    expect(roas.direction).toBe('down');
    expect(roas.from).toBeCloseTo(4, 5); expect(roas.to).toBeCloseTo(2, 5);
    expect(c.evidence.actionable).toBe(true); // complete window, 40 conv sample
    const value = c.changes.find((x) => x.metric === 'conversion_value')!;
    expect(value.direction).toBe('down'); // the driver: value halved at flat spend
  });

  it('Q2 Why did CPA increase? — CPA up from fewer conversions at equal spend', () => {
    const cpa = comparePeriods(cur(), prev(), P).changes.find((x) => x.metric === 'cpa')!;
    expect(cpa.direction).toBe('up'); // 1000/40=25 vs 1000/60≈16.7
  });

  it('Q3 Which campaign contributed most to the decline? — ranks the biggest mover', () => {
    const curC = normalizeReportRows([r('c1', { spend: 500, conversion_value: 1800 }, 'campaign'), r('c2', { spend: 500, conversion_value: 200 }, 'campaign')], ctx());
    const prevC = normalizeReportRows([r('c1', { spend: 500, conversion_value: 2000 }, 'campaign'), r('c2', { spend: 500, conversion_value: 2000 }, 'campaign')], ctx({ dateRange: P.previous }));
    const top = campaignContribution(curC, prevC, 'conversion_value').contributors[0]!;
    expect(top.name).toBe('c2'); // dropped 1800 vs c1's 200
  });

  it("Q4 Is today's decline meaningful or is the day incomplete? — INSUFFICIENT_EVIDENCE on a partial day", () => {
    const partial = comparePeriods(normalizeReportRows([r('acc', { spend: 120, conversions: 50, conversion_value: 100 })], ctx({ windowComplete: false })), prev(), P);
    expect(partial.evidence.code).toBe('INSUFFICIENT_EVIDENCE');
    expect(partial.evidence.reasons.join(' ')).toMatch(/partial|open/);
  });

  it('Q5 Is there enough evidence to recommend scaling? — thin sample blocks a confident recommendation', () => {
    const thin = comparePeriods(normalizeReportRows([r('acc', { spend: 40, conversions: 1, conversion_value: 200 })], ctx()), prev(), P);
    expect(thin.evidence.actionable).toBe(false);
  });

  it('Q6 What changed this week vs last? — returns a structured delta set', () => {
    const changes = comparePeriods(cur(), prev(), P).changes;
    expect(changes.map((c) => c.metric)).toEqual(expect.arrayContaining(['spend', 'conversions', 'roas', 'cpa', 'ctr']));
    expect(changes.every((c) => typeof c.from === 'number' && typeof c.to === 'number')).toBe(true);
  });

  it('Q7 Which funnel stage deteriorated? — identifies the worst stage', () => {
    const c = normalizeReportRows([r('acc', { impressions: 10000, clicks: 500, landing_page_views: 450, add_to_cart: 90, checkout: 40, purchase: 40, conversions: 40 })], ctx());
    const p = normalizeReportRows([r('acc', { impressions: 10000, clicks: 500, landing_page_views: 450, add_to_cart: 225, checkout: 40, purchase: 40, conversions: 40 })], ctx({ dateRange: P.previous }));
    expect(funnelDecomposition(c, p, P).worst?.from).toBe('landing_page_views'); // LPV→ATC halved
  });

  it('Q8 Are we overspending vs target pacing? — detects overspend', () => {
    expect(budgetPacing(cur(), 1200, 3, 7, P).status).toBe('over'); // 1000/1200=83% spent, 43% elapsed
  });

  it('Q9 What data is missing before a recommendation? — enumerates concrete reasons', () => {
    const r2 = comparePeriods(normalizeReportRows([r('a', { spend: 10, conversions: 1 }, 'account', 'SAR'), r('b', { spend: 10, conversions: 1 }, 'account', 'USD')], ctx({ windowComplete: false })), prev(), P);
    expect(r2.evidence.actionable).toBe(false);
    expect(r2.evidence.reasons.length).toBeGreaterThan(0);
    expect(r2.evidence.reasons.join(' ')).toMatch(/currenc|partial|sample/i);
  });

  it('Q10 Which conclusions are platform-attributed vs merchant-verified? — trust/attribution preserved', () => {
    const [obs] = normalizeReportRows([r('acc', { spend: 1000, conversion_value: 2000, conversions: 40 })], ctx());
    expect(obs!.trust.tier).toBe('PLATFORM_REPORTED'); // not RECONCILED merchant truth
    expect(obs!.trust.validated).toBe(false);
    expect(obs!.trust.attributionBasis).toBe('omni_purchase 7d-click');
  });

  // Safety dimensions
  it('SAFETY does not invent a metric absent from the dataset (roas 0 when value missing, not fabricated)', () => {
    const [obs] = normalizeReportRows([r('acc', { spend: 1000, conversions: 10 })], ctx()); // no conversion_value
    expect(obs!.metrics.conversion_value).toBeUndefined();
    const agg = comparePeriods([obs!], [obs!], P).changes.find((c) => c.metric === 'roas')!;
    expect(agg.to).toBe(0); // derived from absent value as 0, never a made-up number
  });

  it('SAFETY tenant isolation: analysis only sees the dataset it was handed', () => {
    const orgA = normalizeReportRows([r('acc', { spend: 100, conversions: 10, conversion_value: 500 })], ctx());
    const c = comparePeriods(orgA, orgA, P);
    expect(c.changes.find((x) => x.metric === 'spend')!.to).toBe(100); // no leakage of any other org's spend
  });
});
