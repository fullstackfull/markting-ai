/**
 * Deterministic media-buyer analysis (Phase 1L). The arithmetic lives HERE, not in the model: the
 * LLM explains these signals, it does not compute them. Every function is pure, currency-safe (never
 * sums or blends across currencies — no invented FX), recomputes ratio metrics from base totals
 * (never averages ratios), and is gated by the data-trust evidence floor so thin/incomplete/synthetic
 * data yields INSUFFICIENT_EVIDENCE rather than a fabricated conclusion. Labels are bilingual (en/ar).
 */
import { evaluateEvidence, type DataTier, type DataTrust } from '../data-trust';
import type { CanonicalMetric, MetricObservation } from './model';

export type Direction = 'up' | 'down' | 'flat';
export interface BiLabel { en: string; ar: string }

export const METRIC_LABELS: Record<string, BiLabel> = {
  spend: { en: 'Spend', ar: 'الإنفاق' },
  impressions: { en: 'Impressions', ar: 'مرات الظهور' },
  clicks: { en: 'Clicks', ar: 'النقرات' },
  conversions: { en: 'Conversions', ar: 'التحويلات' },
  conversion_value: { en: 'Conversion value', ar: 'قيمة التحويل' },
  ctr: { en: 'CTR', ar: 'CTR' }, cpc: { en: 'CPC', ar: 'CPC' }, cpm: { en: 'CPM', ar: 'CPM' },
  cpa: { en: 'CPA', ar: 'CPA' }, roas: { en: 'ROAS', ar: 'ROAS' },
};

const BASE_METRICS: CanonicalMetric[] = [
  'spend', 'impressions', 'clicks', 'conversions', 'conversion_value',
  'video_views', 'engagement', 'landing_page_views', 'add_to_cart', 'checkout', 'purchase', 'lead',
];
const TIER_RANK: Record<DataTier, number> = { SYNTHETIC: 0, UNVERIFIED: 1, PLATFORM_REPORTED: 2, VALIDATED: 3, RECONCILED: 4 };

export interface Aggregate {
  currency?: string;
  base: Partial<Record<CanonicalMetric, number>>;
  derived: Partial<Record<CanonicalMetric, number>>;
  sampleSize: number;
  complete: boolean;
  worstTier: DataTier;
  currencies: string[];
  mixedCurrency: boolean;
}

/** Sum base metrics and recompute ratios from the sums. Flags when observations span currencies. */
export function aggregate(obs: MetricObservation[]): Aggregate {
  const base: Partial<Record<CanonicalMetric, number>> = {};
  const currencies = new Set<string>();
  let sampleSize = 0;
  let complete = true;
  let worst: DataTier = 'RECONCILED';
  for (const o of obs) {
    if (o.currency) currencies.add(o.currency);
    if (o.trust.complete === false) complete = false;
    if (TIER_RANK[o.trust.tier as DataTier] < TIER_RANK[worst]) worst = o.trust.tier as DataTier;
    sampleSize += Math.round(o.metrics.conversions ?? 0);
    for (const m of BASE_METRICS) {
      const v = o.metrics[m];
      if (typeof v === 'number') base[m] = (base[m] ?? 0) + v;
    }
  }
  const spend = base.spend ?? 0;
  const impressions = base.impressions ?? 0;
  const clicks = base.clicks ?? 0;
  const conv = base.conversions ?? 0;
  const value = base.conversion_value ?? 0;
  const derived: Partial<Record<CanonicalMetric, number>> = {
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpc: clicks ? spend / clicks : 0,
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    cpa: conv ? spend / conv : 0,
    roas: spend ? value / spend : 0,
  };
  return {
    currency: currencies.size === 1 ? [...currencies][0] : undefined,
    base, derived, sampleSize, complete, worstTier: worst,
    currencies: [...currencies], mixedCurrency: currencies.size > 1,
  };
}

function pctChange(from: number, to: number): number | undefined {
  if (!Number.isFinite(from) || from === 0) return undefined;
  return ((to - from) / Math.abs(from)) * 100;
}
function direction(from: number, to: number, epsPct = 1): Direction {
  const p = pctChange(from, to);
  if (p === undefined || Math.abs(p) < epsPct) return 'flat';
  return p > 0 ? 'up' : 'down';
}

export interface MetricChange {
  metric: CanonicalMetric;
  label: BiLabel;
  from: number;
  to: number;
  absolute: number;
  pct?: number;
  direction: Direction;
}

export interface EvidenceNote { actionable: boolean; code?: 'INSUFFICIENT_EVIDENCE'; reasons: string[] }

function trustFor(agg: Aggregate, dateRange: { start: string; end: string }): DataTrust {
  return {
    tier: agg.worstTier, source: 'aggregate', complete: agg.complete,
    currency: agg.currency, sampleSize: agg.sampleSize, dateRange,
  };
}

export interface PerformanceChange {
  currency?: string;
  mixedCurrency: boolean;
  changes: MetricChange[];
  evidence: EvidenceNote;
  headline?: MetricChange;
}

/**
 * Compare two periods at the account/aggregate level. Returns raw deltas always (clearly flagged),
 * and an evidence note that turns INSUFFICIENT_EVIDENCE when the data cannot support a confident
 * ratio-based conclusion (synthetic/partial/thin/mixed-currency/unknown-currency).
 */
export function comparePeriods(
  current: MetricObservation[],
  previous: MetricObservation[],
  period: { current: { start: string; end: string }; previous: { start: string; end: string } },
): PerformanceChange {
  const cur = aggregate(current);
  const prev = aggregate(previous);
  const metrics: CanonicalMetric[] = ['spend', 'conversions', 'conversion_value', 'cpa', 'roas', 'ctr', 'cpm', 'cpc', 'clicks', 'impressions'];
  const changes: MetricChange[] = metrics.map((m) => {
    const from = prev.base[m] ?? prev.derived[m] ?? 0;
    const to = cur.base[m] ?? cur.derived[m] ?? 0;
    return { metric: m, label: METRIC_LABELS[m] ?? { en: m, ar: m }, from, to, absolute: to - from, pct: pctChange(from, to), direction: direction(from, to) };
  });
  const reasons: string[] = [];
  if (cur.mixedCurrency || prev.mixedCurrency) reasons.push('observations span multiple currencies; totals are not comparable without FX');
  if (!cur.currency && !cur.mixedCurrency) reasons.push('reporting currency unknown');
  // Ratio-based confidence rests on the evidence floor applied to the current window.
  const ev = evaluateEvidence(trustFor(cur, period.current), { ratioBased: true });
  if (!ev.actionable) reasons.push(...ev.reasons);
  const headline = [...changes].filter((c) => c.metric === 'roas' || c.metric === 'cpa').sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))[0];
  return {
    currency: cur.currency, mixedCurrency: cur.mixedCurrency, changes,
    evidence: reasons.length ? { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons } : { actionable: true, reasons: [] },
    headline,
  };
}

export const FUNNEL_STAGES: CanonicalMetric[] = ['impressions', 'clicks', 'landing_page_views', 'add_to_cart', 'checkout', 'purchase'];

export interface FunnelStageChange { from: CanonicalMetric; to: CanonicalMetric; label: BiLabel; rateFrom: number; rateTo: number; deltaPct?: number }
export interface FunnelDecomposition { stages: FunnelStageChange[]; worst?: FunnelStageChange; evidence: EvidenceNote }

/** Stage-to-stage conversion rates for the stages present in both periods; identify the worst drop. */
export function funnelDecomposition(
  current: MetricObservation[],
  previous: MetricObservation[],
  period: { current: { start: string; end: string } },
): FunnelDecomposition {
  const cur = aggregate(current);
  const prev = aggregate(previous);
  const stages: FunnelStageChange[] = [];
  for (let i = 0; i < FUNNEL_STAGES.length - 1; i++) {
    const from = FUNNEL_STAGES[i]!;
    const to = FUNNEL_STAGES[i + 1]!;
    const cf = cur.base[from]; const ct = cur.base[to];
    const pf = prev.base[from]; const pt = prev.base[to];
    if ([cf, ct, pf, pt].some((v) => typeof v !== 'number')) continue; // stage absent in the data
    const rateTo = cf! > 0 ? (ct! / cf!) * 100 : 0;
    const rateFrom = pf! > 0 ? (pt! / pf!) * 100 : 0;
    stages.push({ from, to, label: { en: `${from}→${to}`, ar: `${from}←${to}` }, rateFrom, rateTo, deltaPct: pctChange(rateFrom, rateTo) });
  }
  const worst = [...stages].sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))[0];
  const ev = evaluateEvidence(trustFor(cur, period.current), { ratioBased: true });
  return { stages, worst: worst && (worst.deltaPct ?? 0) < 0 ? worst : undefined, evidence: ev.actionable ? { actionable: true, reasons: [] } : { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons: ev.reasons } };
}

export interface PacingResult { expectedFraction: number; actualFraction: number; status: 'under' | 'over' | 'on_track'; label: BiLabel; spend: number; plannedBudget: number; currency?: string; evidence: EvidenceNote }

/** Compare actual spend fraction against the straight-line expected fraction for the elapsed window. */
export function budgetPacing(
  current: MetricObservation[],
  plannedBudgetForPeriod: number,
  daysElapsed: number,
  daysInPeriod: number,
  period: { current: { start: string; end: string } },
): PacingResult {
  const cur = aggregate(current);
  const spend = cur.base.spend ?? 0;
  const expectedFraction = daysInPeriod > 0 ? Math.min(1, daysElapsed / daysInPeriod) : 0;
  const actualFraction = plannedBudgetForPeriod > 0 ? spend / plannedBudgetForPeriod : 0;
  const drift = actualFraction - expectedFraction;
  const status = Math.abs(drift) < 0.1 ? 'on_track' : drift > 0 ? 'over' : 'under';
  const reasons: string[] = [];
  if (plannedBudgetForPeriod <= 0) reasons.push('no planned budget configured');
  if (cur.mixedCurrency) reasons.push('spend spans multiple currencies');
  return {
    expectedFraction, actualFraction, status,
    label: { en: status === 'over' ? 'Overspending' : status === 'under' ? 'Underspending' : 'On track', ar: status === 'over' ? 'إنفاق زائد' : status === 'under' ? 'إنفاق ناقص' : 'ضمن المسار' },
    spend, plannedBudget: plannedBudgetForPeriod, currency: cur.currency,
    evidence: reasons.length ? { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons } : { actionable: true, reasons: [] },
  };
}

export interface AnomalyPoint { index: number; value: number; z: number; isAnomaly: boolean }
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
/**
 * Deterministic anomaly flag using the robust modified z-score (median + MAD), which — unlike a
 * mean/σ z-score — does not let a single large spike inflate the spread and mask itself at small n.
 * Normal volatility below the threshold is NOT an anomaly. Falls back to mean/σ only when MAD is 0.
 */
export function anomalyDetection(series: number[], threshold = 3.5, minPoints = 7): { points: AnomalyPoint[]; evidence: EvidenceNote } {
  if (series.length < minPoints) return { points: [], evidence: { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons: [`need at least ${minPoints} points, got ${series.length}`] } };
  const med = median(series);
  const mad = median(series.map((v) => Math.abs(v - med)));
  let score: (v: number) => number;
  if (mad > 0) {
    score = (v) => (0.6745 * (v - med)) / mad;
  } else {
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
    score = (v) => (sd === 0 ? 0 : (v - mean) / sd);
  }
  const points = series.map((value, index) => {
    const z = score(value);
    return { index, value, z, isAnomaly: Math.abs(z) >= threshold };
  });
  return { points, evidence: { actionable: true, reasons: [] } };
}

export interface Contributor { entityId: string; name: string; metricDelta: number; sharePct: number }
/**
 * Which campaigns explain most of an account-level metric movement. Contribution share is each
 * campaign's absolute delta over the sum of absolute deltas (so it is well-defined even when some
 * campaigns moved opposite the account).
 */
export function campaignContribution(
  currentByCampaign: MetricObservation[],
  previousByCampaign: MetricObservation[],
  metric: CanonicalMetric,
): { contributors: Contributor[]; evidence: EvidenceNote } {
  const prevMap = new Map(previousByCampaign.map((o) => [o.entity.id, o]));
  const deltas: Contributor[] = currentByCampaign.map((o) => {
    const prev = prevMap.get(o.entity.id);
    const to = o.metrics[metric] ?? 0;
    const from = prev?.metrics[metric] ?? 0;
    return { entityId: o.entity.id, name: o.entity.name, metricDelta: to - from, sharePct: 0 };
  });
  const totalAbs = deltas.reduce((a, c) => a + Math.abs(c.metricDelta), 0);
  for (const d of deltas) d.sharePct = totalAbs > 0 ? (Math.abs(d.metricDelta) / totalAbs) * 100 : 0;
  deltas.sort((a, b) => Math.abs(b.metricDelta) - Math.abs(a.metricDelta));
  return { contributors: deltas, evidence: totalAbs > 0 ? { actionable: true, reasons: [] } : { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons: ['no campaign-level movement'] } };
}
