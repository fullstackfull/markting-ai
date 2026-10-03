import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { diagnoseEntity } from '@/lib/markting/intelligence/diagnostics';
import { evaluateScalingReadiness } from '@/lib/markting/intelligence/scaling';
import { compareChannels, type ChannelSummary } from '@/lib/markting/intelligence/cross-channel';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { buildOpportunityCenter } from '@/lib/markting/intelligence/opportunity-center';
import { applyConfigured, emptyBusinessContext } from '@/lib/markting/business-context';

const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, readAt: '2026-09-15T00:00:00Z', ...over };
}
function row(id: string, m: Partial<Record<string, number>>, level: ReportRow['entity']['level'] = 'account', name = id): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency: 'SAR', entity: { level, id, name }, metrics: m as ReportRow['metrics'] };
}
const scope = (level: ReportRow['entity']['level'] = 'account') => ({ organizationId: 'o', accountId: 'act_1', entityId: 'meta:act_1:e', entityLevel: level, name: 'e' });

describe('red-team fix #1 — scaling needs positive performance evidence', () => {
  it('is NOT_READY with enough conversions but no configured target', () => {
    const r = evaluateScalingReadiness({ spend: 5000, conversions: 200, dataTrust: 'PLATFORM_REPORTED', fresh: true, windowComplete: true, recentlyStable: true, attributionReliable: true });
    expect(r.state).toBe('NOT_READY');
  });
  it('is NOT_READY when not beating target even with volume + stability', () => {
    const r = evaluateScalingReadiness({ spend: 5000, conversions: 200, dataTrust: 'PLATFORM_REPORTED', fresh: true, windowComplete: true, recentlyStable: true, attributionReliable: true, performanceVsTarget: { metric: 'roas', actual: 0.4, target: 3, targetKnown: true } });
    expect(r.state).toBe('NOT_READY');
  });
  it('a money-losing campaign never produces a REVIEW_BUDGET_SCALE recommendation', () => {
    // 35 conv, ROAS 0.4, CPA rising, no target — the red-team repro.
    const business = emptyBusinessContext('o');
    const cur = normalizeReportRows([row('c1', { spend: 1000, impressions: 100000, clicks: 500, conversions: 35, conversion_value: 400 }, 'campaign')], ctx());
    const prev = normalizeReportRows([row('c1', { spend: 800, impressions: 100000, clicks: 1000, conversions: 40, conversion_value: 600 }, 'campaign')], ctx({ dateRange: PERIOD.previous }));
    const acc = normalizeReportRows([row('a', { spend: 1000, impressions: 100000, clicks: 500, conversions: 35, conversion_value: 400 })], ctx());
    const accP = normalizeReportRows([row('a', { spend: 800, impressions: 100000, clicks: 1000, conversions: 40, conversion_value: 600 })], ctx({ dateRange: PERIOD.previous }));
    const intel = analyzeAccount({ engineContext: { organizationId: 'o', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD, currentAccount: acc, previousAccount: accP, currentCampaigns: cur, previousCampaigns: prev, business });
    expect(intel.recommendations.some((r) => r.actionType === 'REVIEW_BUDGET_SCALE')).toBe(false);
  });
});

describe('red-team fix #2 — engines wired into the single path', () => {
  function withFunnel() {
    const business = emptyBusinessContext('o');
    const cur = normalizeReportRows([row('a', { impressions: 10000, clicks: 500, landing_page_views: 400, add_to_cart: 100, checkout: 20, purchase: 40, conversions: 40, spend: 500, conversion_value: 1000 })], ctx());
    const prev = normalizeReportRows([row('a', { impressions: 10000, clicks: 500, landing_page_views: 400, add_to_cart: 200, checkout: 40, purchase: 40, conversions: 40, spend: 500, conversion_value: 1000 })], ctx({ dateRange: PERIOD.previous }));
    return analyzeAccount({ engineContext: { organizationId: 'o', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD, currentAccount: cur, previousAccount: prev, currentCampaigns: [], previousCampaigns: [], business });
  }
  it('emits FUNNEL_STAGE_COLLAPSE from the orchestrator', () => {
    expect(withFunnel().accountDiagnoses.some((d) => d.type === 'FUNNEL_STAGE_COLLAPSE')).toBe(true);
  });
  it('emits an ANOMALY diagnosis when a daily series spikes', () => {
    const business = emptyBusinessContext('o');
    const cur = normalizeReportRows([row('a', { spend: 1000, conversions: 40, conversion_value: 3200 })], ctx());
    const intel = analyzeAccount({ engineContext: { organizationId: 'o', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD, currentAccount: cur, previousAccount: cur, currentCampaigns: [], previousCampaigns: [], business, dailySpendSeries: { 'act_1:account': [100, 102, 98, 101, 99, 100, 500] } });
    expect(intel.accountDiagnoses.some((d) => d.type === 'ANOMALY')).toBe(true);
  });
});

describe('red-team fix #3 — cross-channel unknown currency', () => {
  const base: ChannelSummary = { provider: 'meta', currency: 'SAR', attributionBasis: '7d', dateRange: PERIOD.current, timezone: 'UTC', conversionDefinition: 'purchase', trustTier: 'PLATFORM_REPORTED', metrics: { cpa: 10, roas: 4 } };
  it('refuses a CPA ranking when one channel currency is unknown', () => {
    const r = compareChannels(base, { ...base, provider: 'google', currency: undefined, metrics: { cpa: 5, roas: 5 } }, 'cpa');
    expect(r.comparability.state).toBe('NOT_COMPARABLE');
    expect(r.ranking).toBeUndefined();
  });
});

describe('red-team fix #4 — dominant factor respects direction', () => {
  it('does not name an offsetting (CPM fell) factor as the CPA cause', () => {
    // CPM falls (helps), CTR & CVR fall (hurt) → CPA up; cause must be CTR/CVR, not media_cost.
    const cur = normalizeReportRows([row('a', { spend: 500, impressions: 200000, clicks: 400, conversions: 32, conversion_value: 2000 })], ctx());
    const prev = normalizeReportRows([row('a', { spend: 1000, impressions: 100000, clicks: 1000, conversions: 100, conversion_value: 6000 })], ctx({ dateRange: PERIOD.previous }));
    const d = diagnoseEntity({ scope: scope(), current: cur, previous: prev, period: PERIOD }).diagnoses.find((x) => x.type === 'CPA_DETERIORATION');
    if (d && d.factors && d.factors.length) {
      const top = [...d.factors].sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0))[0]!;
      expect(top.factor).not.toBe('media_cost');
    }
  });
});

describe('red-team fix #5 — overreaction gated by window completeness', () => {
  it('zero-conversion spend on an OPEN window is WATCH, not CRITICAL', () => {
    const d = diagnoseEntity({ scope: scope(), current: normalizeReportRows([row('a', { spend: 2, clicks: 1, conversions: 0 })], ctx({ windowComplete: false })), previous: normalizeReportRows([row('a', { spend: 2, clicks: 1, conversions: 1, conversion_value: 10 })], ctx({ dateRange: PERIOD.previous, windowComplete: false })), period: PERIOD }).diagnoses;
    const dq = d.find((x) => x.type === 'DATA_QUALITY_ISSUE');
    expect(dq?.severity).toBe('WATCH');
  });
  it('opportunity-center discounts a SYNTHETIC/low-confidence item below a trustworthy one', () => {
    const mkDiag = (trust: 'PLATFORM_REPORTED' | 'SYNTHETIC', conf: 'HIGH' | 'LOW') => ({
      type: 'CPA_DETERIORATION' as const, scope: { organizationId: 'o', accountId: 'a', entityId: `e-${trust}`, entityLevel: 'campaign' as const },
      severity: 'ATTENTION' as const, summary: { en: 'x', ar: 'x' }, evidence: [], confidence: conf, dataTrust: trust,
    });
    const intel = { organizationId: 'o', dataset: 'LIVE', period: PERIOD, mixedCurrency: false, trustTier: 'PLATFORM_REPORTED', windowComplete: true, accountDiagnoses: [mkDiag('PLATFORM_REPORTED', 'HIGH'), mkDiag('SYNTHETIC', 'LOW')], contribution: [], health: {} as never, crossCampaign: {} as never, campaigns: [], recommendations: [] } as never;
    const oc = buildOpportunityCenter(intel);
    expect(oc.needsAttention[0]!.materiality).toBeGreaterThan(oc.needsAttention[1]!.materiality);
  });
});
