/**
 * Phase 4N — EXPLAINABLE creative clustering. Clusters are formed by a transparent feature key
 * (media type + primary hook + top angle + format + CTA bucket), never an opaque embedding. Every
 * cluster exposes its defining features, member creatives, sample size, a performance summary, and
 * trust. O(N): a single pass bucketing by key. Currency-mixed clusters report mixedCurrency and do not
 * blend monetary ratios.
 */
import { aggregate } from '../intelligence/analysis';
import type { DataTier } from '../data-trust';
import type { Creative } from './model';
import { classifyCreativeText, type CreativeTextClassification } from './classify';

export interface CreativeCluster {
  clusterId: string;
  definingFeatures: string[];
  creativeIds: string[];
  sampleSize: number;        // total conversions behind the cluster (evidence)
  // spend is null when the cluster mixes currencies — a cross-currency spend SUM is meaningless.
  performance: { spend: number | null; conversions: number; ctr?: number; cpa?: number; roas?: number; currency?: string; mixedCurrency: boolean };
  trustTier: DataTier;
}

function ctaBucket(cta?: string): string {
  if (!cta) return 'cta:none';
  const l = cta.toLowerCase();
  if (/shop|buy|order|اشتر|اطلب/.test(l)) return 'cta:purchase';
  if (/sign|subscribe|register|سجل|اشترك/.test(l)) return 'cta:signup';
  if (/learn|more|تعلّم|المزيد/.test(l)) return 'cta:learn';
  return 'cta:other';
}

function keyFor(c: Creative, cls: CreativeTextClassification): { key: string; features: string[] } {
  const hook = cls.primaryHook;
  const angle = cls.angles[0]?.value ?? 'UNKNOWN';
  const fmt = c.assets[0]?.format ?? c.mediaType;
  const cta = ctaBucket(c.text?.cta);
  const features = [`media:${c.mediaType}`, `hook:${hook}`, `angle:${angle}`, `format:${fmt}`, cta];
  return { key: features.join('|'), features };
}

export function clusterCreatives(creatives: Creative[]): CreativeCluster[] {
  const buckets = new Map<string, { features: string[]; items: Creative[] }>();
  for (const c of creatives) {
    const cls = classifyCreativeText(c.text);
    const { key, features } = keyFor(c, cls);
    const b = buckets.get(key) ?? { features, items: [] };
    b.items.push(c);
    buckets.set(key, b);
  }
  const clusters: CreativeCluster[] = [];
  for (const [key, b] of buckets) {
    // Aggregate performance safely via the Phase-2 aggregate (currency-aware; mixed → ratios undefined).
    const obs = b.items.map((c) => ({
      provider: c.provider, accountId: c.accountId,
      entity: { level: 'ad' as const, id: c.id, rawId: c.rawId, name: c.id, sourceProvider: c.provider, accountId: c.accountId },
      dateRange: { start: '', end: '' }, currency: c.performance.currency, trust: c.trust,
      metrics: { spend: c.performance.spend, impressions: c.performance.impressions, clicks: c.performance.clicks, conversions: c.performance.conversions, conversion_value: c.performance.conversionValue },
    }));
    const agg = aggregate(obs as never);
    const sampleSize = Math.round(agg.base.conversions ?? 0);
    clusters.push({
      clusterId: `cluster:${key}`,
      definingFeatures: b.features,
      creativeIds: b.items.map((c) => c.id),
      sampleSize,
      performance: { spend: agg.mixedCurrency ? null : Math.round((agg.base.spend ?? 0) * 100) / 100, conversions: sampleSize, ctr: agg.derived.ctr, cpa: agg.derived.cpa, roas: agg.derived.roas, currency: agg.currency, mixedCurrency: agg.mixedCurrency },
      trustTier: agg.worstTier as DataTier,
    });
  }
  // Order by currency-agnostic materiality (conversions) first, then spend as a tie-break within it —
  // never sort primarily by a spend number that may not be comparable across currencies (and spend is
  // null for mixed-currency clusters).
  return clusters.sort((a, b) => b.sampleSize - a.sampleSize || (b.performance.spend ?? 0) - (a.performance.spend ?? 0));
}
