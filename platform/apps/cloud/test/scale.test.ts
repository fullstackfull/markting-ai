import { describe, expect, it } from 'vitest';
import { buildScaling, buildCreative, buildScenario, buildPacing } from '@/lib/markting/orchestrator/sections';
import type { SeedAccount, SeedCampaign, SeedCreative } from '@/lib/markting/orchestrator/seed';

/**
 * Coherence-2 Program 27 — scale micro-benchmark of the ACTUAL orchestrator workload (section builders
 * that run the real engines). Measures wall-clock over 100/1000/10000 campaigns and 10000 creatives and
 * asserts the orchestrator path stays well-bounded (it is O(n) over campaigns/creatives). NOTE: the
 * separate DB read paths flagged in the reassessment (effectivenessRows full scans, upsertOrders N+1)
 * are not exercised here — they are not on the surfaced orchestrator path; see docs/coherence2/09-scale.
 */
const DAYS = 28;
const series = (base: number) => Array.from({ length: DAYS }, (_, i) => base + i);

function bigAccount(nCampaigns: number, nCreatives: number): SeedAccount {
  const campaigns: SeedCampaign[] = Array.from({ length: nCampaigns }, (_, i) => ({
    id: `c${i}`, name: `Campaign ${i}`, role: 'acquisition', currency: 'SAR',
    dailySpendMinor: series(1000 + i), dailyConversions: series(20), dailyClicks: series(500),
    dailyImpressions: series(10000), dailyRevenueMinor: series(4000 + i), budgetMinor: 1_000_000,
    targetRoas: 4, targetKnown: true, dominantCreativeFatigue: 'NO_SIGNAL',
  }));
  const creatives: SeedCreative[] = Array.from({ length: nCreatives }, (_, i) => ({
    id: `cr${i}`, name: `Creative ${i}`, campaignId: `c${i % Math.max(1, nCampaigns)}`, hook: `Hook ${i % 20}`, angle: 'A', format: 'image',
    spendMinor: 10000 + i, impressions: 100000, clicks: 2000, conversions: 60, ctrSeries: series(100), frequencySeries: series(5), firstSeenDaysAgo: 30,
  }));
  return {
    accountId: 'scale', provider: 'sandbox', reportingCurrency: 'SAR', timezone: 'Asia/Riyadh',
    freshnessAt: new Date().toISOString(), periodDaysElapsed: 18, periodDays: 30,
    campaigns, creatives, commerce: null, outcomes: [], memory: [], experiments: [],
    dataQuality: {}, breakdowns: [], channels: [],
  };
}

const time = (fn: () => void): number => { const t = performance.now(); fn(); return Math.round(performance.now() - t); };

describe('Program 27 — orchestrator scale micro-benchmark', () => {
  it('scaling + pacing stay bounded across 100 / 1,000 / 10,000 campaigns', () => {
    const results: Record<number, number> = {};
    for (const n of [100, 1000, 10000]) {
      const acc = bigAccount(n, 0);
      results[n] = time(() => { buildScaling(acc); buildPacing(acc); buildScenario(acc); });
    }
    // eslint-disable-next-line no-console
    console.log('SCALE campaigns ms:', results);
    expect(results[10000]).toBeLessThan(5000); // generous bound; O(n) path, no DB
  });

  it('creative aggregation stays bounded at 10,000 creatives', () => {
    const acc = bigAccount(1000, 10000);
    const ms = time(() => { const s = buildCreative(acc); expect(s.rows.length).toBe(10000); });
    // eslint-disable-next-line no-console
    console.log('SCALE creatives(10k) ms:', ms);
    expect(ms).toBeLessThan(5000);
  });
});
