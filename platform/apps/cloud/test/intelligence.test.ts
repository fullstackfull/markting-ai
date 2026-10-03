import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { aggregate, anomalyDetection, budgetPacing, campaignContribution, comparePeriods, funnelDecomposition } from '@/lib/markting/intelligence/analysis';
import { buildAnalysisContext } from '@/lib/markting/intelligence/context';
import type { MetricObservation } from '@/lib/markting/intelligence/model';

const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function liveCtx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, timezone: 'Asia/Riyadh', readAt: '2026-09-15T00:00:00Z', attribution: { meta: { label: 'omni_purchase 7d-click' } }, ...over };
}
function row(id: string, m: Partial<Record<string, number>>, currency = 'SAR', level: ReportRow['entity']['level'] = 'account'): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency, entity: { level, id, name: id }, metrics: m as ReportRow['metrics'] };
}

describe('normalize → canonical observation (1C/1F)', () => {
  it('maps metrics, preserves currency, attaches trust + attribution + sample size', () => {
    const [obs] = normalizeReportRows([row('acc', { spend: 1000, clicks: 50, impressions: 10000, conversions: 40, conversion_value: 3000 })], liveCtx());
    expect(obs!.currency).toBe('SAR');
    expect(obs!.trust.tier).toBe('PLATFORM_REPORTED');
    expect(obs!.trust.attributionBasis).toBe('omni_purchase 7d-click');
    expect(obs!.trust.sampleSize).toBe(40);
    expect(obs!.metrics.spend).toBe(1000);
    expect(obs!.entity.id).toBe('meta:act_1:acc');
  });
  it('tags synthetic data as SYNTHETIC so it can never read as live evidence', () => {
    const [obs] = normalizeReportRows([row('acc', { spend: 1 })], liveCtx({ tier: 'SYNTHETIC' }));
    expect(obs!.trust.tier).toBe('SYNTHETIC');
  });
});

describe('aggregate: currency-safe, recomputes ratios from sums', () => {
  it('sums base metrics and derives ratios, flags mixed currency', () => {
    const obs = normalizeReportRows([row('a', { spend: 100, clicks: 10, impressions: 1000, conversions: 5, conversion_value: 500 }), row('b', { spend: 100, clicks: 10, impressions: 1000, conversions: 5, conversion_value: 300 })], liveCtx());
    const agg = aggregate(obs);
    expect(agg.base.spend).toBe(200);
    expect(agg.derived.roas).toBeCloseTo(4, 5); // 800/200, from sums not averaged
    expect(agg.mixedCurrency).toBe(false);
    const mixed = aggregate(normalizeReportRows([row('a', { spend: 1 }, 'SAR'), row('b', { spend: 1 }, 'USD')], liveCtx()));
    expect(mixed.mixedCurrency).toBe(true);
    expect(mixed.currency).toBeUndefined();
  });
});

describe('comparePeriods (1L)', () => {
  const cur = () => normalizeReportRows([row('acc', { spend: 1000, clicks: 40, impressions: 10000, conversions: 40, conversion_value: 2000 })], liveCtx());
  const prev = () => normalizeReportRows([row('acc', { spend: 1000, clicks: 50, impressions: 10000, conversions: 60, conversion_value: 4000 })], liveCtx({ dateRange: PERIOD.previous }));
  it('detects a ROAS decline with evidence when the window is complete and sample sufficient', () => {
    const r = comparePeriods(cur(), prev(), PERIOD);
    const roas = r.changes.find((c) => c.metric === 'roas')!;
    expect(roas.direction).toBe('down'); // 4.0 → 2.0
    expect(r.evidence.actionable).toBe(true);
  });
  it('returns INSUFFICIENT_EVIDENCE on a partial current window', () => {
    const r = comparePeriods(normalizeReportRows([row('acc', { spend: 10, conversions: 50, conversion_value: 20 })], liveCtx({ windowComplete: false })), prev(), PERIOD);
    expect(r.evidence.actionable).toBe(false);
    expect(r.evidence.code).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('returns INSUFFICIENT_EVIDENCE on a thin sample (few conversions)', () => {
    const r = comparePeriods(normalizeReportRows([row('acc', { spend: 50, conversions: 2, conversion_value: 100 })], liveCtx()), prev(), PERIOD);
    expect(r.evidence.actionable).toBe(false);
  });
  it('flags mixed currency as non-comparable', () => {
    const r = comparePeriods(normalizeReportRows([row('a', { spend: 500, conversions: 40, conversion_value: 1000 }, 'SAR'), row('b', { spend: 500, conversions: 40, conversion_value: 1000 }, 'USD')], liveCtx()), prev(), PERIOD);
    expect(r.evidence.actionable).toBe(false);
    expect(r.evidence.reasons.join(' ')).toMatch(/currenc/i);
  });
});

describe('funnel, pacing, anomaly, contribution', () => {
  it('funnel finds the worst-deteriorating stage', () => {
    const cur = normalizeReportRows([row('acc', { impressions: 10000, clicks: 500, landing_page_views: 400, add_to_cart: 100, checkout: 20, purchase: 40, conversions: 40 })], liveCtx());
    const prev = normalizeReportRows([row('acc', { impressions: 10000, clicks: 500, landing_page_views: 400, add_to_cart: 200, checkout: 40, purchase: 40, conversions: 40 })], liveCtx({ dateRange: PERIOD.previous }));
    const f = funnelDecomposition(cur, prev, PERIOD);
    expect(f.worst?.from).toBe('landing_page_views'); // add_to_cart rate halved
  });
  it('pacing detects overspend', () => {
    const p = budgetPacing(normalizeReportRows([row('acc', { spend: 800 })], liveCtx()), 1000, 3, 7, PERIOD);
    expect(p.status).toBe('over'); // 80% spent, 43% elapsed
  });
  it('pacing is INSUFFICIENT_EVIDENCE without a planned budget', () => {
    expect(budgetPacing(normalizeReportRows([row('acc', { spend: 800 })], liveCtx()), 0, 3, 7, PERIOD).evidence.actionable).toBe(false);
  });
  it('anomaly flags a spike beyond threshold, not normal volatility', () => {
    const steady = anomalyDetection([100, 102, 98, 101, 99, 100, 103]);
    expect(steady.points.some((p) => p.isAnomaly)).toBe(false);
    const spike = anomalyDetection([100, 102, 98, 101, 99, 100, 300]);
    expect(spike.points.at(-1)!.isAnomaly).toBe(true);
  });
  it('anomaly needs enough points', () => {
    expect(anomalyDetection([1, 2, 3]).evidence.actionable).toBe(false);
  });
  it('campaign contribution ranks the biggest mover', () => {
    const cur = normalizeReportRows([row('c1', { spend: 100 }, 'SAR', 'campaign'), row('c2', { spend: 900 }, 'SAR', 'campaign')], liveCtx());
    const prev = normalizeReportRows([row('c1', { spend: 100 }, 'SAR', 'campaign'), row('c2', { spend: 300 }, 'SAR', 'campaign')], liveCtx({ dateRange: PERIOD.previous }));
    const c = campaignContribution(cur, prev, 'spend');
    expect(c.contributors[0]!.name).toBe('c2');
    expect(c.contributors[0]!.sharePct).toBe(100);
  });
});

describe('context builder budgeting (1H)', () => {
  it('keeps top-N campaigns by spend-delta share and reports the summarized remainder', () => {
    const mk = (n: number, base: number, dr = PERIOD.current, tier: NormalizeContext['tier'] = 'PLATFORM_REPORTED') =>
      normalizeReportRows(Array.from({ length: n }, (_, i) => row(`c${i}`, { spend: base + i * 10, conversions: 40, conversion_value: 100 }, 'SAR', 'campaign')), liveCtx({ dateRange: dr, tier }));
    const ctx = buildAnalysisContext({
      organizationId: 'org-1', dataset: 'LIVE',
      currentAccount: normalizeReportRows([row('acc', { spend: 5000, conversions: 400, conversion_value: 10000 })], liveCtx()),
      previousAccount: normalizeReportRows([row('acc', { spend: 5000, conversions: 400, conversion_value: 12000 })], liveCtx({ dateRange: PERIOD.previous })),
      currentCampaigns: mk(25, 100), previousCampaigns: mk(25, 50, PERIOD.previous),
      period: PERIOD, budget: { maxCampaigns: 10, maxRows: 50 },
    });
    expect(ctx.topCampaigns.length).toBe(10);
    expect(ctx.summarizedCampaignCount).toBe(15);
    expect(ctx.truncated).toBe(true);
    expect(ctx.currency).toBe('SAR');
    expect(ctx.dataset).toBe('LIVE');
  });
});
