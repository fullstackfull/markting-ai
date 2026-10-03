/**
 * Phase 2O — cross-channel intelligence foundation. Before ANY provider-vs-provider comparison, the
 * data must be validated as comparable: same currency, compatible attribution window, overlapping date
 * range, same conversion definition, same timezone, and trustworthy tiers. ROAS/CPA are never summed
 * or ranked across incompatible data — a fake "cross-platform winner" from incomparable inputs is
 * exactly what this gate prevents. Output is COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE with
 * the reasons spelled out.
 */
import type { DataTier } from '../data-trust';
import type { BiText, Comparability } from './decision-model';

export interface ChannelSummary {
  provider: string;
  currency?: string;
  attributionBasis?: string;
  dateRange?: { start: string; end: string };
  timezone?: string;
  /** Conversion event/definition label (e.g. 'purchase', 'omni_purchase'). */
  conversionDefinition?: string;
  trustTier: DataTier;
  metrics: { spend?: number; conversions?: number; conversion_value?: number; roas?: number; cpa?: number };
}

export interface ComparabilityCheck {
  state: Comparability;
  reasons: string[];
  /** Dimensions that matched vs differed, for explainability. */
  matched: string[];
  differed: string[];
}

export function checkComparability(a: ChannelSummary, b: ChannelSummary): ComparabilityCheck {
  const matched: string[] = [];
  const differed: string[] = [];
  const reasons: string[] = [];

  const cmp = (name: string, x?: string, y?: string, hard = false) => {
    if (x == null || y == null) { differed.push(`${name}(unknown)`); reasons.push(`${name} unknown on at least one channel`); return; }
    if (x === y) matched.push(name);
    else { differed.push(name); reasons.push(`${name} differs (${x} vs ${y})${hard ? '' : ''}`); }
  };

  cmp('currency', a.currency, b.currency, true);
  cmp('attribution', a.attributionBasis, b.attributionBasis);
  cmp('conversionDefinition', a.conversionDefinition, b.conversionDefinition);
  cmp('timezone', a.timezone, b.timezone);
  // Date range: require exact match for COMPARABLE, overlap for PARTIAL.
  if (a.dateRange && b.dateRange) {
    if (a.dateRange.start === b.dateRange.start && a.dateRange.end === b.dateRange.end) matched.push('dateRange');
    else if (overlaps(a.dateRange, b.dateRange)) { differed.push('dateRange(overlap)'); reasons.push('date ranges differ but overlap'); }
    else { differed.push('dateRange'); reasons.push('date ranges do not overlap'); }
  } else { differed.push('dateRange(unknown)'); reasons.push('date range unknown on at least one channel'); }

  const lowTrust = (t: DataTier) => t === 'SYNTHETIC' || t === 'UNVERIFIED';
  if (lowTrust(a.trustTier) || lowTrust(b.trustTier)) reasons.push('one channel is synthetic/unverified — not comparable as live evidence');

  // Hard blockers → NOT_COMPARABLE.
  const currencyDiffers = a.currency && b.currency && a.currency !== b.currency;
  const noDateOverlap = a.dateRange && b.dateRange && !overlaps(a.dateRange, b.dateRange);
  if (currencyDiffers || noDateOverlap || lowTrust(a.trustTier) || lowTrust(b.trustTier)) {
    return { state: 'NOT_COMPARABLE', reasons, matched, differed };
  }
  // Soft differences (attribution/conversion-definition/timezone/date-overlap) → PARTIALLY_COMPARABLE.
  const soft = differed.some((d) => ['attribution', 'conversionDefinition', 'timezone', 'dateRange(overlap)', 'dateRange(unknown)', 'attribution(unknown)', 'conversionDefinition(unknown)', 'timezone(unknown)'].includes(d));
  return { state: soft ? 'PARTIALLY_COMPARABLE' : 'COMPARABLE', reasons: soft ? reasons : ['all comparability dimensions match'], matched, differed };
}

export interface CrossChannelComparison {
  comparability: ComparabilityCheck;
  /** Only populated when COMPARABLE or PARTIALLY_COMPARABLE (then clearly caveated). */
  ranking?: Array<{ provider: string; metric: 'roas' | 'cpa'; value: number }>;
  caveat?: BiText;
}

/** Compare channels on a metric ONLY when the gate allows it; otherwise return the gate alone. */
export function compareChannels(a: ChannelSummary, b: ChannelSummary, metric: 'roas' | 'cpa'): CrossChannelComparison {
  const comparability = checkComparability(a, b);
  if (comparability.state === 'NOT_COMPARABLE') {
    return { comparability, caveat: { en: 'Channels are not comparable; no ranking produced.', ar: 'القنوات غير قابلة للمقارنة؛ لم يُنتَج أي ترتيب.' } };
  }
  const va = a.metrics[metric];
  const vb = b.metrics[metric];
  if (va == null || vb == null) {
    return { comparability, caveat: { en: `${metric.toUpperCase()} missing on at least one channel.`, ar: `${metric.toUpperCase()} غير متوفر على قناة واحدة على الأقل.` } };
  }
  const higherBetter = metric === 'roas';
  const ranking = [{ provider: a.provider, metric, value: va }, { provider: b.provider, metric, value: vb }]
    .sort((x, y) => (higherBetter ? y.value - x.value : x.value - y.value));
  const caveat: BiText = comparability.state === 'PARTIALLY_COMPARABLE'
    ? { en: 'Only partially comparable — treat the ranking as indicative, not definitive.', ar: 'قابلية مقارنة جزئية فقط — اعتبر الترتيب استرشاديًا لا قطعيًا.' }
    : { en: 'Comparable on all checked dimensions.', ar: 'قابل للمقارنة على جميع الأبعاد المفحوصة.' };
  return { comparability, ranking, caveat };
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end;
}
