import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { emptyBusinessContext, applyConfigured } from '@/lib/markting/business-context';
import {
  reportingLevelSupport, reportingDimensionSupport, reachableBreakdownDimensions, adGroupTerm,
} from '@/lib/connections/registry';

/**
 * PHASE B (B1/B2/B12/B23) — lower-hierarchy depth in the single deterministic engine, plus the
 * provider reporting-capability matrix that gates the UI. No parallel pipeline: the same
 * analyzeAccount descends campaign → ad_group → ad via provider-native parent linkage.
 */
const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, timezone: 'Asia/Riyadh', readAt: '2026-09-15T00:00:00Z', ...over };
}
function row(id: string, level: ReportRow['entity']['level'], m: Record<string, number>, parentId?: string, entityType?: string): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency: 'SAR', entity: { level, id, name: id, parentId, entityType }, metrics: m as ReportRow['metrics'] };
}

describe('hierarchy depth (B2): campaign → ad_group → ad', () => {
  const business = applyConfigured(emptyBusinessContext('org-1'), { targetRoas: 3, targetCpa: 20, reportingCurrency: 'SAR' });
  function run() {
    const cAcc = normalizeReportRows([row('acc', 'account', { spend: 2000, impressions: 200000, clicks: 1000, conversions: 50, conversion_value: 4000 })], ctx());
    const pAcc = normalizeReportRows([row('acc', 'account', { spend: 2000, impressions: 200000, clicks: 1200, conversions: 80, conversion_value: 6000 })], ctx({ dateRange: PERIOD.previous }));
    const cCamp = normalizeReportRows([row('c1', 'campaign', { spend: 2000, impressions: 200000, clicks: 1000, conversions: 50, conversion_value: 4000 })], ctx());
    const pCamp = normalizeReportRows([row('c1', 'campaign', { spend: 2000, impressions: 200000, clicks: 1200, conversions: 80, conversion_value: 6000 })], ctx({ dateRange: PERIOD.previous }));
    // Two ad sets under c1; CPA worsens mostly because ag2's conversions collapsed.
    const cGroups = normalizeReportRows([
      row('c1-ag1', 'ad_group', { spend: 800, impressions: 80000, clicks: 420, conversions: 32, conversion_value: 2600 }, 'c1', 'adset'),
      row('c1-ag2', 'ad_group', { spend: 1200, impressions: 120000, clicks: 580, conversions: 18, conversion_value: 1400 }, 'c1', 'adset'),
    ], ctx());
    const pGroups = normalizeReportRows([
      row('c1-ag1', 'ad_group', { spend: 800, impressions: 80000, clicks: 500, conversions: 34, conversion_value: 2700 }, 'c1', 'adset'),
      row('c1-ag2', 'ad_group', { spend: 1200, impressions: 120000, clicks: 700, conversions: 46, conversion_value: 3300 }, 'c1', 'adset'),
    ], ctx({ dateRange: PERIOD.previous }));
    const cAds = normalizeReportRows([
      row('c1-ag2-ad1', 'ad', { spend: 700, impressions: 70000, clicks: 330, conversions: 8, conversion_value: 600 }, 'c1-ag2', 'ad'),
      row('c1-ag2-ad2', 'ad', { spend: 500, impressions: 50000, clicks: 250, conversions: 10, conversion_value: 800 }, 'c1-ag2', 'ad'),
    ], ctx());
    const pAds = normalizeReportRows([
      row('c1-ag2-ad1', 'ad', { spend: 700, impressions: 70000, clicks: 400, conversions: 26, conversion_value: 1900 }, 'c1-ag2', 'ad'),
      row('c1-ag2-ad2', 'ad', { spend: 500, impressions: 50000, clicks: 300, conversions: 20, conversion_value: 1400 }, 'c1-ag2', 'ad'),
    ], ctx({ dateRange: PERIOD.previous }));
    return analyzeAccount({
      engineContext: { organizationId: 'org-1', timezone: 'Asia/Riyadh', locale: 'en' }, dataset: 'LIVE', period: PERIOD,
      currentAccount: cAcc, previousAccount: pAcc, currentCampaigns: cCamp, previousCampaigns: pCamp,
      currentAdGroups: cGroups, previousAdGroups: pGroups, currentAds: cAds, previousAds: pAds, business,
    });
  }

  it('builds campaign → ad_group → ad nodes with provider-native type preserved', () => {
    const intel = run();
    const c1 = intel.campaigns.find((c) => c.entityId.endsWith('c1'))!;
    expect(c1.children).toBeDefined();
    expect(c1.children!.length).toBe(2);
    const ag = c1.children!.map((g) => ({ level: g.level, type: g.entityType }));
    expect(ag.every((g) => g.level === 'ad_group' && g.type === 'adset')).toBe(true);
    const ag2 = c1.children!.find((g) => g.entityId.endsWith('c1-ag2'))!;
    expect(ag2.children!.length).toBe(2); // two ads under ag2
    expect(ag2.children!.every((a) => a.level === 'ad')).toBe(true);
  });

  it('computes contribution (which child drove the parent move) and diagnoses at every level', () => {
    const intel = run();
    const c1 = intel.campaigns.find((c) => c.entityId.endsWith('c1'))!;
    // Contribution across ad sets is present and names both children (which child drove the move).
    expect(c1.childContribution && c1.childContribution.length).toBe(2);
    expect(c1.childContribution!.some((c) => c.entityId.endsWith('c1-ag2'))).toBe(true);
    // Lower-level diagnoses are produced (the collapsing ad set / ads emit conversion/CPA findings).
    const ag2 = c1.children!.find((g) => g.entityId.endsWith('c1-ag2'))!;
    expect(ag2.diagnoses.length).toBeGreaterThan(0);
    expect(ag2.diagnoses.every((d) => d.scope.entityLevel === 'ad_group')).toBe(true);
    expect(ag2.children!.some((a) => a.diagnoses.length > 0)).toBe(true);
  });

  it('produces no children when no child observations are supplied (never fabricated)', () => {
    const business2 = business;
    const cCamp = normalizeReportRows([row('c1', 'campaign', { spend: 1000, impressions: 100000, clicks: 500, conversions: 25, conversion_value: 2000 })], ctx());
    const intel = analyzeAccount({
      engineContext: { organizationId: 'org-1', timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD,
      currentAccount: cCamp, previousAccount: cCamp, currentCampaigns: cCamp, previousCampaigns: cCamp, business: business2,
    });
    expect(intel.campaigns[0]!.children).toBeUndefined();
  });
});

describe('reporting capability registry (B23): the single gating source of truth', () => {
  it('reflects the audited per-provider level support (no generalization)', () => {
    expect(reportingLevelSupport('meta', 'ad_group')).toBe('READY');
    expect(reportingLevelSupport('google', 'ad')).toBe('READY');
    expect(reportingLevelSupport('reddit', 'ad_group')).toBe('PARTIAL');
    expect(reportingLevelSupport('linkedin', 'ad_group')).toBe('NOT_SUPPORTED');
    expect(reportingLevelSupport('microsoft', 'ad_group')).toBe('NOT_IMPLEMENTED');
    expect(reportingLevelSupport('apple', 'ad')).toBe('NOT_IMPLEMENTED');
  });
  it('uses provider-native ad_group terminology', () => {
    expect(adGroupTerm('meta').en).toBe('Ad set');
    expect(adGroupTerm('google').en).toBe('Ad group');
    expect(adGroupTerm('x').en).toBe('Line item');
  });
  it('never claims a breakdown dimension flows into the normalized path (RAW_ONLY at best)', () => {
    expect(reportingDimensionSupport('meta', 'placement')).toBe('RAW_ONLY');
    expect(reportingDimensionSupport('google', 'keyword')).toBe('NOT_SUPPORTED');
    expect(reportingDimensionSupport('spotify', 'device')).toBe('NOT_SUPPORTED');
    // No provider is READY for any breakdown dimension (none feed the canonical ReportRow).
    expect(reachableBreakdownDimensions('meta').length).toBeGreaterThan(0); // reachable via raw tool
    expect(reachableBreakdownDimensions('pinterest').length).toBe(0);
  });
});
