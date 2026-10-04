import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows } from '@/lib/markting/intelligence/normalize';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { validateReportRow } from '@/lib/cloud/live-gatherer';
import { emptyBusinessContext } from '@/lib/markting/business-context';

/**
 * PHASE A (A4/A5/A8) — LIVE VALUE LOOP end-to-end through the REAL pipeline, driven by DOCUMENTATION-
 * DERIVED / SYNTHETIC contract fixtures (NOT a live provider — this is not live verification). Proves:
 * ReportRow → validate → normalize (PLATFORM_REPORTED) → analyzeAccount → computed, evidence-backed
 * diagnosis; source-mode is live (never SYNTHETIC); currency is preserved and mixed currency is flagged;
 * the loop is deterministic/idempotent on replay.
 */
const ORG = 'org_live_loop';
const PERIOD = { current: { start: '2026-09-28', end: '2026-10-04' }, previous: { start: '2026-09-21', end: '2026-09-27' } };

// A clear CPA deterioration: same spend, far fewer conversions this period (ample sample size).
const curCampaigns: ReportRow[] = [
  { provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: 'c1', name: 'Prospecting' }, metrics: { spend: 10000, clicks: 2000, conversions: 50, conversion_value: 20000 } },
];
const prevCampaigns: ReportRow[] = [
  { provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'campaign', id: 'c1', name: 'Prospecting' }, metrics: { spend: 10000, clicks: 2000, conversions: 200, conversion_value: 60000 } },
];

function normalize(rows: ReportRow[], range: { start: string; end: string }) {
  return normalizeReportRows(rows, { tier: 'PLATFORM_REPORTED', dateRange: range, windowComplete: true, timezone: 'Asia/Riyadh', readAt: '2026-10-04T06:00:00.000Z' });
}

function run() {
  const currentCampaigns = normalize(curCampaigns, PERIOD.current);
  const previousCampaigns = normalize(prevCampaigns, PERIOD.previous);
  return analyzeAccount({
    engineContext: { organizationId: ORG, timezone: 'Asia/Riyadh', locale: 'en' },
    dataset: 'LIVE', period: PERIOD,
    currentAccount: currentCampaigns, previousAccount: previousCampaigns,
    currentCampaigns, previousCampaigns,
    business: emptyBusinessContext(ORG),
  });
}

describe('live value loop (contract fixtures through the real pipeline)', () => {
  it('rows pass validation then normalize to LIVE-tier observations (never SYNTHETIC)', () => {
    expect(curCampaigns.every((r) => validateReportRow(r).ok)).toBe(true);
    const obs = normalize(curCampaigns, PERIOD.current);
    expect(obs[0]!.trust.tier).toBe('PLATFORM_REPORTED');
    expect(obs[0]!.trust.source).toBe('meta-report'); // not 'sandbox-fixture'
    expect(obs[0]!.currency).toBe('USD');
  });

  it('produces a computed, evidence-backed diagnosis of the CPA deterioration', () => {
    const intel = run();
    expect(intel.trustTier).toBe('PLATFORM_REPORTED');
    expect(intel.currency).toBe('USD');
    const all = [...intel.accountDiagnoses, ...intel.campaigns.flatMap((c) => c.diagnoses)];
    expect(all.length).toBeGreaterThan(0);
    const cpa = all.find((d) => d.type === 'CPA_DETERIORATION');
    expect(cpa, 'CPA deterioration diagnosed').toBeTruthy();
    expect(cpa!.evidence.length, 'diagnosis carries machine-reconstructable evidence').toBeGreaterThan(0);
    expect(cpa!.dataTrust).toBe('PLATFORM_REPORTED');
  });

  it('is deterministic/idempotent on replay (same diagnoses, stable canonical ids)', () => {
    const a = run();
    const b = run();
    const ids = (x: typeof a) => x.campaigns.flatMap((c) => c.diagnoses).map((d) => `${d.type}:${d.scope.entityId}`).sort();
    expect(ids(a)).toEqual(ids(b));
    // Canonical observation ids are deterministic (provider:account:rawId).
    const o1 = normalize(curCampaigns, PERIOD.current)[0]!;
    const o2 = normalize(curCampaigns, PERIOD.current)[0]!;
    expect(o1.entity.id).toBe(o2.entity.id);
    expect(o1.entity.id).toBe('meta:act_1:c1');
  });

  it('flags mixed currency rather than blending it (no invented FX)', () => {
    const mixed = analyzeAccount({
      engineContext: { organizationId: ORG, timezone: 'UTC', locale: 'en' }, dataset: 'LIVE', period: PERIOD,
      currentAccount: normalize([
        { provider: 'meta', accountId: 'act_1', currency: 'USD', entity: { level: 'account', id: 'a', name: 'A' }, metrics: { spend: 100, conversions: 10 } },
        { provider: 'google', accountId: 'act_2', currency: 'SAR', entity: { level: 'account', id: 'b', name: 'B' }, metrics: { spend: 100, conversions: 10 } },
      ], PERIOD.current),
      previousAccount: [], currentCampaigns: [], previousCampaigns: [],
      business: emptyBusinessContext(ORG),
    });
    expect(mixed.mixedCurrency).toBe(true);
    expect(mixed.currency).toBeUndefined();
  });
});

/**
 * REAL-LIVE readiness: the SAME code path, gated off by default. Enabled only with real provider
 * credentials + ADPORT_RUN_LIVE_PROVIDER_TESTS=1 — never run in ordinary CI, never called "live"
 * without actual live evidence.
 */
const describeLive = process.env.ADPORT_RUN_LIVE_PROVIDER_TESTS === '1' ? describe : describe.skip;
describeLive('live provider loop (requires real credentials — disabled by default)', () => {
  it('placeholder — wire a real TenantPrincipal + gatherLive here when credentials exist', () => {
    expect(process.env.ADPORT_RUN_LIVE_PROVIDER_TESTS).toBe('1');
  });
});
