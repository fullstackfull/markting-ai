import { describe, expect, it } from 'vitest';
import { assessFatigue } from '@/lib/markting/creative/fatigue';
import { creativeContribution, creativeShares } from '@/lib/markting/creative/performance';
import { clusterCreatives } from '@/lib/markting/creative/clustering';
import { relationBetween, dedupGroups } from '@/lib/markting/creative/dedup';
import { generateCreativeRecommendations } from '@/lib/markting/creative/recommendations';
import type { Creative } from '@/lib/markting/creative/model';
import type { DataTrust } from '@/lib/markting/data-trust';

const trust = (over: Partial<DataTrust> = {}): DataTrust => ({ tier: 'PLATFORM_REPORTED', source: 'meta-report', complete: true, currency: 'SAR', sampleSize: 60, ...over });
function creative(id: string, over: Partial<Creative> = {}): Creative {
  return { id, rawId: id, provider: 'meta', organizationId: 'o', accountId: 'act_1', mediaType: 'image', assets: [], performance: { currency: 'SAR' }, trust: trust(), ...over };
}

// Regression tests for the Phase-4 expert creative red-team findings.
describe('Phase-4 red-team fixes', () => {
  // PARTIAL-1: a FALLING CPM means the CTR/CPC move can be an auction-wide cheap-impression effect, so
  // fatigue must NOT be confirmed — it is held at WATCH, and no fatigue recommendation is emitted.
  it('fatigue: falling CPM is RULED OUT, not merely noted → WATCH, no fatigue recommendation', () => {
    const fatigue = assessFatigue({ dataTrust: 'PLATFORM_REPORTED', frequency: { from: 2, to: 3.6 }, ctr: { from: 2, to: 1.5 }, cpm: { from: 10, to: 7 }, impressions: 5000, conversions: 60, windowComplete: true });
    expect(fatigue.state).toBe('WATCH');
    expect(fatigue.reasons.join(' ')).toMatch(/auction-driven/i);
    const recs = generateCreativeRecommendations({ organizationId: 'o', accountId: 'act_1', creativeId: 'c1', dataTrust: 'PLATFORM_REPORTED', fatigue });
    expect(recs.some((r) => r.category === 'CREATIVE_FATIGUE_REVIEW')).toBe(false);
  });
  it('fatigue: UNKNOWN CPM cannot rule out an auction cause → held at WATCH', () => {
    const r = assessFatigue({ dataTrust: 'PLATFORM_REPORTED', frequency: { from: 2, to: 4 }, ctr: { from: 2, to: 1.3 }, cpc: { from: 1, to: 1.4 }, conversions: 60, impressions: 50000, windowComplete: true });
    expect(r.state).toBe('WATCH');
  });
  it('fatigue: stable CPM + corroboration still reaches STRONG (not over-suppressed)', () => {
    const r = assessFatigue({ dataTrust: 'PLATFORM_REPORTED', frequency: { from: 2, to: 4 }, ctr: { from: 2, to: 1.3 }, cpc: { from: 1, to: 1.4 }, cpm: { from: 10, to: 11 }, conversions: 60, impressions: 50000, windowComplete: true });
    expect(r.state).toBe('STRONG_FATIGUE_SIGNAL');
  });

  // PARTIAL-2: without KNOWN CPM movement an efficiency metric cannot be attributed to the creative.
  it('contribution: CPA with unknown CPM → INSUFFICIENT_EVIDENCE, never a false "media cost stable"', () => {
    const cur = [creative('c1', { performance: { currency: 'SAR', cpa: 30, conversions: 40 } })];
    const prev = [creative('c1', { performance: { currency: 'SAR', cpa: 20, conversions: 40 } })];
    const r = creativeContribution(cur, prev, 'cpa');
    expect(r.attribution).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.note.en.toLowerCase()).not.toContain('media cost stable');
    expect(r.note.en.toLowerCase()).toContain('cannot be separated');
  });
  it('contribution: a volume metric (conversions) with unknown CPM does not over-claim stability', () => {
    const cur = [creative('c1', { performance: { currency: 'SAR', conversions: 60 } })];
    const prev = [creative('c1', { performance: { currency: 'SAR', conversions: 40 } })];
    const r = creativeContribution(cur, prev, 'conversions');
    expect(r.attribution).toBe('CREATIVE_DRIVEN');
    expect(r.note.en.toLowerCase()).toContain('not assessed');
  });

  // PARTIAL-4: creativeShares must not blend spend across currencies.
  it('creativeShares: mixed currencies → spendShare null; uniform → a number', () => {
    const mixed = creativeShares([
      creative('c1', { performance: { currency: 'SAR', spend: 100, impressions: 1000 } }),
      creative('c2', { performance: { currency: 'USD', spend: 100, impressions: 1000 } }),
    ]);
    expect(mixed.every((s) => s.spendShare === null)).toBe(true);
    expect(mixed[0]!.impressionShare).toBe(50); // counts stay currency-agnostic
    const uniform = creativeShares([
      creative('c1', { performance: { currency: 'SAR', spend: 75 } }),
      creative('c2', { performance: { currency: 'SAR', spend: 25 } }),
    ]);
    expect(uniform[0]!.spendShare).toBe(75);
  });

  // PARTIAL-5: clusters never report a cross-currency spend SUM, and ordering is currency-agnostic.
  it('clustering: mixed-currency cluster has null spend (no blended sum) + mixedCurrency', () => {
    const cs = [
      creative('c1', { performance: { currency: 'SAR', spend: 100, conversions: 40, conversionValue: 400 } }),
      creative('c2', { performance: { currency: 'USD', spend: 100, conversions: 40, conversionValue: 400 } }),
    ];
    const cluster = clusterCreatives(cs)[0]!;
    expect(cluster.performance.mixedCurrency).toBe(true);
    expect(cluster.performance.spend).toBeNull();
    expect(cluster.performance.roas).toBeUndefined();
  });
  it('clustering: clusters are ordered by currency-agnostic conversions, not a cross-currency spend', () => {
    const cs = [
      creative('big-conv', { mediaType: 'video', performance: { currency: 'SAR', spend: 10, conversions: 500 } }),
      creative('big-spend', { mediaType: 'image', performance: { currency: 'USD', spend: 99999, conversions: 5 } }),
    ];
    expect(clusterCreatives(cs)[0]!.creativeIds).toContain('big-conv');
  });

  // PARTIAL-6: distinct creatives are never merged on copy alone; grouping needs a media-hash match.
  it('dedup: identical copy without a matching media hash → RELATED, never LIKELY_VARIANT', () => {
    const a = creative('c1', { assets: [{ assetId: 'a', rawAssetId: 'a', provider: 'meta', mediaType: 'image' }], text: { headline: 'Summer Sale 50% off' } });
    const b = creative('c2', { assets: [{ assetId: 'b', rawAssetId: 'b', provider: 'meta', mediaType: 'image' }], text: { headline: 'Summer Sale 50% off' } });
    expect(relationBetween(a, b).relation).toBe('RELATED');
    // dedupGroups groups only on a shared media hash, so these two never merge.
    expect(dedupGroups([a, b])).toHaveLength(0);
  });
  it('dedup: a shared media hash still groups (exact vs variant by copy)', () => {
    const a = creative('c1', { assets: [{ assetId: 'a', rawAssetId: 'a', provider: 'meta', mediaType: 'image', contentHash: 'H1' }], text: { headline: 'Buy now' } });
    const b = creative('c2', { assets: [{ assetId: 'b', rawAssetId: 'b', provider: 'meta', mediaType: 'image', contentHash: 'H1' }], text: { headline: 'Shop today' } });
    const c = creative('c3', { assets: [{ assetId: 'c', rawAssetId: 'c', provider: 'meta', mediaType: 'image', contentHash: 'H1' }], text: { headline: 'Buy now' } });
    const groups = dedupGroups([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(groups[0]!.relation).toBe('LIKELY_VARIANT'); // copies differ
  });
});
