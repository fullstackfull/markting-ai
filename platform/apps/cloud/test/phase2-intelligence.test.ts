import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { diagnoseEntity } from '@/lib/markting/intelligence/diagnostics';
import { deriveConfidence } from '@/lib/markting/intelligence/confidence';
import { analyzePacing } from '@/lib/markting/intelligence/pacing';
import { evaluateScalingReadiness, evaluateDownscaleCandidacy } from '@/lib/markting/intelligence/scaling';
import { classifyTrend } from '@/lib/markting/intelligence/trend';
import { detectAnomalies } from '@/lib/markting/intelligence/anomaly';
import { forecastCumulative, forecastCpa } from '@/lib/markting/intelligence/forecast';
import { analyzeCrossCampaign } from '@/lib/markting/intelligence/cross-campaign';
import { checkComparability, compareChannels, type ChannelSummary } from '@/lib/markting/intelligence/cross-channel';
import { analyzeCreatives } from '@/lib/markting/intelligence/creative';
import { analyzeBreakdown } from '@/lib/markting/intelligence/audience';
import { classifyRisk } from '@/lib/markting/intelligence/risk';
import { generateRecommendations } from '@/lib/markting/intelligence/recommendation';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { buildOpportunityCenter } from '@/lib/markting/intelligence/opportunity-center';
import { buildMorningBrief } from '@/lib/markting/intelligence/brief';
import { explainRecommendation, isFullyExplainable } from '@/lib/markting/intelligence/explainability';
import { emptyBusinessContext, applyConfigured } from '@/lib/markting/business-context';

const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, timezone: 'Asia/Riyadh', readAt: '2026-09-15T00:00:00Z', attribution: { meta: { label: 'omni_purchase 7d-click' } }, ...over };
}
function row(id: string, m: Partial<Record<string, number>>, currency = 'SAR', level: ReportRow['entity']['level'] = 'account'): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency, entity: { level, id, name: id }, metrics: m as ReportRow['metrics'] };
}
const scope = { organizationId: 'org-1', accountId: 'act_1', entityId: 'meta:act_1:acc', entityLevel: 'account' as const, name: 'Account' };

describe('diagnostics (2B/2C): CPA/ROAS/CPC factor decomposition', () => {
  it('attributes a CPA rise primarily to CTR when CTR fell and CPM held', () => {
    // CTR halves (clicks 1000→500), CPM steady, conversion rate steady → CPA up, driven by CTR.
    // Both windows clear the ≥30-conversion ratio floor.
    const cur = normalizeReportRows([row('acc', { spend: 1000, impressions: 100000, clicks: 500, conversions: 40, conversion_value: 3200 })], ctx());
    const prev = normalizeReportRows([row('acc', { spend: 1000, impressions: 100000, clicks: 1000, conversions: 80, conversion_value: 6400 })], ctx({ dateRange: PERIOD.previous }));
    const { diagnoses } = diagnoseEntity({ scope, current: cur, previous: prev, period: PERIOD });
    const cpa = diagnoses.find((d) => d.type === 'CPA_DETERIORATION');
    expect(cpa).toBeTruthy();
    const top = [...(cpa!.factors ?? [])].sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0))[0];
    expect(top?.factor).toBe('click_through');
  });

  it('attributes a CPA rise primarily to CPM when media cost rose and CTR/CVR held', () => {
    const cur = normalizeReportRows([row('acc', { spend: 2000, impressions: 100000, clicks: 1000, conversions: 50, conversion_value: 4000 })], ctx());
    const prev = normalizeReportRows([row('acc', { spend: 1000, impressions: 100000, clicks: 1000, conversions: 50, conversion_value: 4000 })], ctx({ dateRange: PERIOD.previous }));
    const { diagnoses } = diagnoseEntity({ scope, current: cur, previous: prev, period: PERIOD });
    const cpa = diagnoses.find((d) => d.type === 'CPA_DETERIORATION');
    const top = [...(cpa!.factors ?? [])].sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0))[0];
    expect(top?.factor).toBe('media_cost');
  });

  it('flags a high-spend zero-conversion entity as a CRITICAL data-quality issue regardless of sample', () => {
    const cur = normalizeReportRows([row('acc', { spend: 500, impressions: 50000, clicks: 200, conversions: 0 })], ctx());
    const prev = normalizeReportRows([row('acc', { spend: 500, impressions: 50000, clicks: 200, conversions: 10, conversion_value: 100 })], ctx({ dateRange: PERIOD.previous }));
    const { diagnoses } = diagnoseEntity({ scope, current: cur, previous: prev, period: PERIOD });
    expect(diagnoses.some((d) => d.type === 'DATA_QUALITY_ISSUE' && d.severity === 'CRITICAL')).toBe(true);
  });

  it('returns INSUFFICIENT_EVIDENCE for ratio reads on a thin sample', () => {
    const cur = normalizeReportRows([row('acc', { spend: 50, impressions: 1000, clicks: 20, conversions: 2, conversion_value: 100 })], ctx());
    const prev = normalizeReportRows([row('acc', { spend: 40, impressions: 1000, clicks: 20, conversions: 3, conversion_value: 150 })], ctx({ dateRange: PERIOD.previous }));
    const { diagnoses } = diagnoseEntity({ scope, current: cur, previous: prev, period: PERIOD });
    expect(diagnoses.some((d) => d.type === 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(diagnoses.some((d) => d.type === 'CPA_DETERIORATION')).toBe(false);
  });
});

describe('confidence (2Q)', () => {
  it('caps at LOW for synthetic/thin, HIGH only when every factor supports it', () => {
    expect(deriveConfidence({ dataTrust: 'SYNTHETIC' })).toBe('LOW');
    expect(deriveConfidence({ dataTrust: 'PLATFORM_REPORTED', ratioBased: true, sampleSize: 5 })).toBe('LOW');
    expect(deriveConfidence({ dataTrust: 'RECONCILED', ratioBased: true, sampleSize: 500, windowComplete: true, fresh: true, attributionConsistent: true, signalStrengthPct: 40 })).toBe('HIGH');
    expect(deriveConfidence({ dataTrust: 'PLATFORM_REPORTED', ratioBased: true, sampleSize: 500, signalStrengthPct: 40, windowComplete: true })).toBe('MEDIUM'); // tier caps at MEDIUM
  });
});

describe('pacing (2E)', () => {
  it('separates underpacing as a delivery/opportunity review, not a scale signal', () => {
    const p = analyzePacing({ spendToDate: 200, plannedBudget: 1000, daysElapsed: 5, daysInPeriod: 7, kind: 'period' });
    expect(p.status).toBe('UNDERPACING');
    expect(p.interpretation).toBe('DELIVERY_OR_OPPORTUNITY_REVIEW');
  });
  it('detects overpacing with a projection', () => {
    const p = analyzePacing({ spendToDate: 900, plannedBudget: 1000, daysElapsed: 4, daysInPeriod: 10, kind: 'period' });
    expect(p.status).toBe('OVERPACING');
    expect(p.projectedSpend).toBeGreaterThan(1000);
  });
  it('is NOT_EVALUABLE on mixed currency', () => {
    expect(analyzePacing({ spendToDate: 1, plannedBudget: 10, daysElapsed: 1, daysInPeriod: 7, kind: 'period', mixedCurrency: true }).status).toBe('NOT_EVALUABLE');
  });
});

describe('scaling + downscale (2F/2G)', () => {
  it('never auto-scales; ready only for human review when all evidence supports it', () => {
    const r = evaluateScalingReadiness({ spend: 5000, conversions: 200, dataTrust: 'PLATFORM_REPORTED', fresh: true, windowComplete: true, recentlyStable: true, attributionReliable: true, performanceVsTarget: { metric: 'roas', actual: 4, target: 3, targetKnown: true } });
    expect(r.state).toBe('READY_FOR_HUMAN_REVIEW');
  });
  it('low spend is never poor performance (observe, not cut)', () => {
    expect(evaluateDownscaleCandidacy({ spend: 0, conversions: 0, observationDays: 14, dataTrust: 'PLATFORM_REPORTED' }).state).toBe('OBSERVE');
  });
  it('thin window cannot be a strong pause candidate', () => {
    const r = evaluateDownscaleCandidacy({ spend: 1000, conversions: 1, observationDays: 2, dataTrust: 'PLATFORM_REPORTED', performanceVsTarget: { metric: 'cpa', actual: 999, target: 10, targetKnown: true }, trendWorsening: true });
    expect(r.state).not.toBe('STRONG_REVIEW_CANDIDATE');
  });
});

describe('trend (2I)', () => {
  it('one spike in a steady series is not a trend', () => {
    expect(classifyTrend([100, 100, 100, 100, 100, 100, 300]).state).toBe('NOISE');
  });
  it('a sustained rise is a persistent trend or structural shift', () => {
    expect(['PERSISTENT_TREND', 'STRUCTURAL_SHIFT']).toContain(classifyTrend([100, 101, 102, 150, 155, 160, 165]).state);
  });
});

describe('anomaly (2H)', () => {
  it('flags a genuine spike as ACTIONABLE/CRITICAL and stays quiet on normal volatility', () => {
    expect(detectAnomalies([100, 102, 98, 101, 99, 100, 103]).actionable).toBe(false);
    const r = detectAnomalies([100, 102, 98, 101, 99, 100, 400]);
    expect(r.actionable).toBe(true);
    expect(['ACTIONABLE', 'CRITICAL']).toContain(r.top!.classification);
  });
});

describe('forecast (2J)', () => {
  it('carries method, window, band and limitations and never a bare point', () => {
    const f = forecastCumulative('spend', [100, 110, 90, 105, 95, 100, 100], 7);
    expect(f.method).toBe('run_rate');
    expect(f.high).toBeGreaterThanOrEqual(f.estimate);
    expect(f.low).toBeLessThanOrEqual(f.estimate);
    expect(f.limitations.length).toBeGreaterThan(0);
  });
  it('CPA forecast drops zero-conversion days and notes it', () => {
    const f = forecastCpa([100, 100, 100], [0, 0, 0]);
    expect(f.confidence).toBe('LOW');
    expect(f.limitations.join(' ')).toMatch(/not forecastable/i);
  });
});

describe('cross-campaign (2N)', () => {
  it('detects spend concentration and only signals possible cannibalization (never asserts it)', () => {
    const camps = normalizeReportRows([row('big', { spend: 9000, conversions: 100 }, 'SAR', 'campaign'), row('small', { spend: 100, conversions: 2 }, 'SAR', 'campaign')], ctx());
    const r = analyzeCrossCampaign(camps);
    expect(r.spendConcentration).toBe('CONCENTRATED');
    expect(['NONE', 'POSSIBLE_NEEDS_PROVIDER_PROOF']).toContain(r.cannibalizationSignal);
  });
});

describe('cross-channel (2O): comparability gating', () => {
  const base: ChannelSummary = { provider: 'meta', currency: 'SAR', attributionBasis: '7d-click', dateRange: PERIOD.current, timezone: 'Asia/Riyadh', conversionDefinition: 'purchase', trustTier: 'PLATFORM_REPORTED', metrics: { roas: 4 } };
  it('refuses to compare different currencies', () => {
    const r = compareChannels(base, { ...base, provider: 'google', currency: 'USD', metrics: { roas: 5 } }, 'roas');
    expect(r.comparability.state).toBe('NOT_COMPARABLE');
    expect(r.ranking).toBeUndefined();
  });
  it('marks differing attribution as partially comparable', () => {
    const r = checkComparability(base, { ...base, provider: 'google', attributionBasis: '1d-click' });
    expect(r.state).toBe('PARTIALLY_COMPARABLE');
  });
  it('ranks only when comparable', () => {
    const r = compareChannels(base, { ...base, provider: 'google', metrics: { roas: 5 } }, 'roas');
    expect(r.comparability.state).toBe('COMPARABLE');
    expect(r.ranking?.[0]?.provider).toBe('google');
  });
});

describe('creative (2L) + audience (2M)', () => {
  it('labels a declining-CTR creative NOT_PROVEN unless frequency context supports fatigue', () => {
    const r = analyzeCreatives([{ creativeId: 'c1', provider: 'meta', accountId: 'act_1', spend: 100, impressions: 5000, ctrSeries: [3, 3, 2.8, 2, 1.8, 1.5] }]);
    expect(['NOT_PROVEN', 'FATIGUE_SIGNAL']).toContain(r.fatigue[0]!.verdict);
  });
  it('never turns a protected dimension into an actionable exclusion', () => {
    const r = analyzeBreakdown('meta', 'age', [{ dimension: 'age', value: '18-24', spend: 100, conversions: 10 }, { dimension: 'age', value: '25-34', spend: 100, conversions: 1 }]);
    expect(r.protectedDimension).toBe(true);
    expect(r.actionable).toBe(false);
  });
  it('reports unsupported breakdowns as unsupported, not fabricated', () => {
    expect(analyzeBreakdown('google', 'audience_segment', []).supported).toBe(false);
  });
});

describe('risk (2R)', () => {
  it('pausing a converting campaign is high risk; investigating is low', () => {
    expect(classifyRisk({ actionType: 'REVIEW_PAUSE', spend: 1000, conversions: 50 }).risk).toBe('HIGH');
    expect(classifyRisk({ actionType: 'INVESTIGATE_ANOMALY', spend: 1000, conversions: 50 }).risk).toBe('LOW');
  });
});

describe('end-to-end analyze (0.3) + surfaces (2T/2U/2W)', () => {
  function scenario() {
    const business = applyConfigured(emptyBusinessContext('org-1'), { targetRoas: 3, targetCpa: 20, reportingCurrency: 'SAR' });
    const currentAccount = normalizeReportRows([row('acc', { spend: 2000, impressions: 200000, clicks: 1000, conversions: 50, conversion_value: 4000 })], ctx());
    const previousAccount = normalizeReportRows([row('acc', { spend: 2000, impressions: 200000, clicks: 2000, conversions: 100, conversion_value: 8000 })], ctx({ dateRange: PERIOD.previous }));
    const currentCampaigns = normalizeReportRows([row('c1', { spend: 1500, impressions: 150000, clicks: 700, conversions: 30, conversion_value: 2400 }, 'SAR', 'campaign'), row('c2', { spend: 500, impressions: 50000, clicks: 300, conversions: 20, conversion_value: 1600 }, 'SAR', 'campaign')], ctx());
    const previousCampaigns = normalizeReportRows([row('c1', { spend: 1500, impressions: 150000, clicks: 1500, conversions: 70, conversion_value: 5600 }, 'SAR', 'campaign'), row('c2', { spend: 500, impressions: 50000, clicks: 500, conversions: 30, conversion_value: 2400 }, 'SAR', 'campaign')], ctx({ dateRange: PERIOD.previous }));
    return analyzeAccount({ engineContext: { organizationId: 'org-1', timezone: 'Asia/Riyadh', locale: 'ar' }, dataset: 'LIVE', period: PERIOD, currentAccount, previousAccount, currentCampaigns, previousCampaigns, business, pacing: { plannedBudget: 5000, daysElapsed: 5, daysInPeriod: 7 }, idFactory: (() => { let n = 0; return () => `rec_${++n}`; })() });
  }

  it('produces diagnoses, recommendations, health and an opportunity center from one path', () => {
    const intel = scenario();
    expect(intel.accountDiagnoses.length).toBeGreaterThan(0);
    expect(intel.recommendations.length).toBeGreaterThan(0);
    expect(intel.recommendations.every((r) => r.requiresHumanApproval === true)).toBe(true);
    const oc = buildOpportunityCenter(intel);
    expect(oc.needsAttention.length + oc.monitoring.length + oc.dataIssues.length).toBeGreaterThan(0);
  });

  it('every recommendation is fully explainable from machine-readable evidence', () => {
    const intel = scenario();
    for (const r of intel.recommendations.filter((r) => r.evidence.length > 0)) {
      expect(isFullyExplainable(explainRecommendation(r))).toBe(true);
    }
  });

  it('morning brief answers the daily questions bilingually', () => {
    const brief = buildMorningBrief(scenario());
    expect(brief.summaryLine.en.length).toBeGreaterThan(0);
    expect(brief.summaryLine.ar.length).toBeGreaterThan(0);
    expect(brief.whatChanged.title.ar).toBeTruthy();
  });
});
