import { describe, expect, it } from 'vitest';
import { buildAnalysisContext, DEFAULT_BUDGET } from '@/lib/markting/intelligence/context';
import type { MetricObservation } from '@/lib/markting/intelligence/model';

/**
 * CODE-RC Program 12 — context-budget validation under large accounts. The orchestrator context must
 * stay BOUNDED regardless of account size: the model/prompt sees at most `maxCampaigns` campaigns
 * (chosen by spend-movement contribution — the ones that explain the change), the remainder are
 * collapsed into a reported count, and truncation is surfaced. No unbounded payload, no silent drop.
 */
const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };

function obs(id: string, spend: number): MetricObservation {
  return {
    provider: 'meta', accountId: 'act_1', entity: { level: 'campaign', id, rawId: id, name: id, sourceProvider: 'meta', accountId: 'act_1' },
    dateRange: PERIOD.current, currency: 'SAR',
    trust: { tier: 'PLATFORM_REPORTED', source: 'aggregate' },
    metrics: { spend, clicks: 10, impressions: 1000, conversions: 5, conversion_value: spend * 2 },
  };
}

describe('context budget stays bounded for a very large account', () => {
  const N = 10_000;
  // Ascending spend so the highest-spend (highest-contribution) campaigns are the last ids.
  const current = Array.from({ length: N }, (_, i) => obs(`c${i}`, 1000 + i));
  const previous = Array.from({ length: N }, (_, i) => obs(`c${i}`, 1000));
  const accountCur = [obs('acc', current.reduce((s, o) => s + (o.metrics.spend ?? 0), 0))];
  const accountPrev = [obs('acc', previous.reduce((s, o) => s + (o.metrics.spend ?? 0), 0))];

  it('keeps at most maxCampaigns and reports the rest as a count (never silently dropped)', () => {
    const t0 = Date.now();
    const ctx = buildAnalysisContext({
      organizationId: 'org-1', dataset: 'LIVE', period: PERIOD,
      currentAccount: accountCur, previousAccount: accountPrev,
      currentCampaigns: current, previousCampaigns: previous,
    });
    const ms = Date.now() - t0;
    expect(ctx.topCampaigns.length).toBeLessThanOrEqual(DEFAULT_BUDGET.maxCampaigns);
    expect(ctx.truncated).toBe(true);
    expect(ctx.summarizedCampaignCount).toBe(N - ctx.topCampaigns.length);
    // Bounded work: assembling a 10k-campaign context must be well under a second.
    expect(ms).toBeLessThan(2000);
  });

  it('preserves the HIGHEST-materiality campaigns (by spend-movement contribution), not arbitrary ones', () => {
    const ctx = buildAnalysisContext({
      organizationId: 'org-1', dataset: 'LIVE', period: PERIOD,
      currentAccount: accountCur, previousAccount: accountPrev,
      currentCampaigns: current, previousCampaigns: previous,
    });
    // The largest movers are the highest-spend ids (c9999, c9998, …); they must be the ones kept.
    const kept = new Set(ctx.topCampaigns.map((c) => c.id));
    expect(kept.has(`c${N - 1}`)).toBe(true);
    expect(kept.has('c0')).toBe(false);
  });

  it('a small account is not truncated', () => {
    const few = Array.from({ length: 3 }, (_, i) => obs(`s${i}`, 500 + i));
    const ctx = buildAnalysisContext({
      organizationId: 'org-1', dataset: 'LIVE', period: PERIOD,
      currentAccount: accountCur, previousAccount: accountPrev,
      currentCampaigns: few, previousCampaigns: few,
    });
    expect(ctx.truncated).toBe(false);
    expect(ctx.summarizedCampaignCount).toBe(0);
  });
});
