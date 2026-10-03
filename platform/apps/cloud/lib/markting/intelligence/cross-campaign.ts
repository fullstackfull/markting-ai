/**
 * Phase 2N — cross-campaign (whole-account) intelligence. Analyzes the account as a portfolio, not
 * campaigns in isolation: spend/performance concentration, budget fragmentation, inactive/low-delivery
 * inventory, and overlapping strategic roles. Cannibalization and audience OVERLAP are only ever
 * flagged as SIGNALS requiring provider proof — never asserted as fact from metrics alone.
 */
import { aggregate } from './analysis';
import type { MetricObservation } from './model';
import type { BiText } from './decision-model';

export interface CrossCampaignReport {
  campaignCount: number;
  activeCount: number;
  /** Herfindahl-Hirschman index of spend share (0..1); higher = more concentrated. */
  spendHHI: number;
  spendConcentration: 'DIVERSE' | 'MODERATE' | 'CONCENTRATED';
  topSpenders: Array<{ id: string; name: string; spendShare: number }>;
  inactiveOrLowDelivery: Array<{ id: string; name: string; spend: number }>;
  fragmentationSignal: boolean;
  cannibalizationSignal: 'NONE' | 'POSSIBLE_NEEDS_PROVIDER_PROOF';
  notes: BiText[];
  currency?: string;
  mixedCurrency: boolean;
}

export interface CrossCampaignOptions {
  /** Spend below this fraction of account spend is "low delivery". */
  lowDeliveryShare?: number;
  /** Number of sub-threshold campaigns to call the account fragmented. */
  fragmentationCount?: number;
}

export function analyzeCrossCampaign(campaigns: MetricObservation[], opts: CrossCampaignOptions = {}): CrossCampaignReport {
  const lowShare = opts.lowDeliveryShare ?? 0.02;
  const fragCount = opts.fragmentationCount ?? 5;
  const acc = aggregate(campaigns);
  const totalSpend = acc.base.spend ?? 0;
  const perCampaign = campaigns.map((c) => ({ id: c.entity.id, name: c.entity.name, spend: c.metrics.spend ?? 0, conversions: c.metrics.conversions ?? 0, status: c.entity.status }));
  const active = perCampaign.filter((c) => c.spend > 0);

  const shares = perCampaign.map((c) => (totalSpend > 0 ? c.spend / totalSpend : 0));
  const spendHHI = shares.reduce((a, s) => a + s * s, 0);
  const spendConcentration = spendHHI >= 0.5 ? 'CONCENTRATED' : spendHHI >= 0.25 ? 'MODERATE' : 'DIVERSE';

  const topSpenders = perCampaign
    .map((c) => ({ id: c.id, name: c.name, spendShare: totalSpend > 0 ? Math.round((c.spend / totalSpend) * 1000) / 10 : 0 }))
    .sort((a, b) => b.spendShare - a.spendShare)
    .slice(0, 5);

  const inactiveOrLowDelivery = perCampaign
    .filter((c) => (totalSpend > 0 ? c.spend / totalSpend : 0) < lowShare)
    .map((c) => ({ id: c.id, name: c.name, spend: Math.round(c.spend * 100) / 100 }));

  const fragmentationSignal = inactiveOrLowDelivery.length >= fragCount && active.length >= fragCount;

  // Cannibalization: metrics alone cannot prove it (needs audience/placement overlap from the provider).
  // We only raise a SIGNAL when many active campaigns share a near-identical name root (a weak hint).
  const roots = new Map<string, number>();
  for (const c of active) {
    const root = c.name.toLowerCase().replace(/[-_#0-9]+.*$/, '').trim().slice(0, 16);
    if (root) roots.set(root, (roots.get(root) ?? 0) + 1);
  }
  const overlappingRoles = [...roots.values()].some((n) => n >= 3);
  const cannibalizationSignal = overlappingRoles ? 'POSSIBLE_NEEDS_PROVIDER_PROOF' : 'NONE';

  const notes: BiText[] = [];
  if (spendConcentration === 'CONCENTRATED') notes.push({ en: 'Spend is concentrated in a few campaigns — single-point risk.', ar: 'الإنفاق مُركّز في عدد قليل من الحملات — مخاطرة نقطة واحدة.' });
  if (fragmentationSignal) notes.push({ en: 'Many low-delivery campaigns — budget may be fragmented.', ar: 'عدد كبير من الحملات منخفضة التسليم — قد تكون الميزانية مجزّأة.' });
  if (cannibalizationSignal === 'POSSIBLE_NEEDS_PROVIDER_PROOF') notes.push({ en: 'Possible overlapping campaign roles — needs provider audience/placement data to confirm any cannibalization.', ar: 'احتمال تداخل أدوار الحملات — يلزم بيانات الجمهور/المواضع من المزوّد لتأكيد أي تنافُس داخلي.' });

  return { campaignCount: perCampaign.length, activeCount: active.length, spendHHI: Math.round(spendHHI * 1000) / 1000, spendConcentration, topSpenders, inactiveOrLowDelivery, fragmentationSignal, cannibalizationSignal, notes, currency: acc.currency, mixedCurrency: acc.mixedCurrency };
}
