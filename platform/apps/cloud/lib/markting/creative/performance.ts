/**
 * Phase 4C/4D/4O/4P/4Q — deterministic creative performance, lifecycle, rating, comparability, and
 * contribution. Evidence-gated (a LOW-SPEND creative is NEVER a "loser"), currency-safe, and careful
 * never to blame the creative when a media-cost (CPM) change explains the result. Comparisons are
 * gated so creatives from different currencies/objectives/audiences/attribution/windows are not
 * compared blindly. Pure.
 */
import { MIN_SAMPLE_FOR_CONFIDENCE, type DataTier } from '../data-trust';
import { classifyTrend } from '../intelligence/trend';
import type { BiText } from '../intelligence/decision-model';
import type { Creative } from './model';

export type CreativeRating = 'PROMISING' | 'STRONG_PERFORMER' | 'AVERAGE' | 'UNDERPERFORMING' | 'INSUFFICIENT_DATA';
export type CreativeLifecycle = 'NEW' | 'LEARNING' | 'MATURE' | 'DECLINING' | 'DORMANT' | 'RETIRED';
export type Comparability = 'COMPARABLE' | 'PARTIALLY_COMPARABLE' | 'NOT_COMPARABLE';

export interface CreativeShares {
  creativeId: string;
  /** null when the set mixes currencies — a spend share across currencies is not meaningful. */
  spendShare: number | null;
  impressionShare: number;
  clickShare: number;
  conversionShare: number;
}

/**
 * Spend/impression/click/conversion shares across a set. Spend share is a MONETARY ratio, so it is
 * only emitted when the set is single-currency; a mixed-currency set yields `spendShare: null` (never
 * a blended-currency number). Impression/click/conversion shares are counts and stay currency-agnostic.
 */
export function creativeShares(creatives: Creative[]): CreativeShares[] {
  const currencies = new Set(creatives.filter((c) => (c.performance.spend ?? 0) > 0).map((c) => c.performance.currency ?? 'unknown'));
  const mixedCurrency = currencies.size > 1;
  const tot = (f: (c: Creative) => number) => creatives.reduce((a, c) => a + f(c), 0);
  const ts = tot((c) => c.performance.spend ?? 0);
  const ti = tot((c) => c.performance.impressions ?? 0);
  const tc = tot((c) => c.performance.clicks ?? 0);
  const tv = tot((c) => c.performance.conversions ?? 0);
  return creatives.map((c) => ({
    creativeId: c.id,
    spendShare: mixedCurrency ? null : ts ? Math.round(((c.performance.spend ?? 0) / ts) * 1000) / 10 : 0,
    impressionShare: ti ? Math.round(((c.performance.impressions ?? 0) / ti) * 1000) / 10 : 0,
    clickShare: tc ? Math.round(((c.performance.clicks ?? 0) / tc) * 1000) / 10 : 0,
    conversionShare: tv ? Math.round(((c.performance.conversions ?? 0) / tv) * 1000) / 10 : 0,
  }));
}

export interface RatingInput {
  creative: Creative;
  /** Cohort median CPA/ROAS among COMPARABLE creatives (caller computes within a comparable set). */
  cohortCpa?: number;
  cohortRoas?: number;
  minConversions?: number;
}
export interface RatingResult { rating: CreativeRating; reasons: string[]; label: BiText }

/** Rate a creative WITHIN a comparable cohort. Low spend / thin conversions → INSUFFICIENT_DATA, never loser. */
export function rateCreative(input: RatingInput): RatingResult {
  const minConv = input.minConversions ?? MIN_SAMPLE_FOR_CONFIDENCE;
  const p = input.creative.performance;
  const tier = input.creative.trust.tier as DataTier;
  const conv = Math.round(p.conversions ?? 0);
  const reasons: string[] = [];
  if (tier === 'SYNTHETIC' || tier === 'UNVERIFIED') reasons.push('data tier too low to rate');
  if ((p.spend ?? 0) <= 0) reasons.push('no spend — observe, not rate');
  if (conv < minConv) reasons.push(`only ${conv} conversions (< ${minConv}) — not enough to judge efficiency`);
  if (reasons.length) return { rating: 'INSUFFICIENT_DATA', reasons, label: LBL.INSUFFICIENT_DATA };

  // Efficiency vs the comparable-cohort median (lower CPA / higher ROAS is better).
  const roas = p.roas;
  const cpa = p.cpa;
  let score = 0;
  if (roas != null && input.cohortRoas) score += roas >= input.cohortRoas * 1.15 ? 1 : roas <= input.cohortRoas * 0.85 ? -1 : 0;
  if (cpa != null && input.cohortCpa && input.cohortCpa > 0) score += cpa <= input.cohortCpa * 0.85 ? 1 : cpa >= input.cohortCpa * 1.15 ? -1 : 0;
  const rating: CreativeRating = score >= 2 ? 'STRONG_PERFORMER' : score === 1 ? 'PROMISING' : score <= -1 ? 'UNDERPERFORMING' : 'AVERAGE';
  reasons.push(`efficiency score ${score} vs comparable cohort median`);
  return { rating, reasons, label: LBL[rating] };
}

export interface LifecycleInput {
  creative: Creative;
  now?: number;
  /** Daily impressions series (oldest→newest) for recent-delivery + trend, when available. */
  deliverySeries?: number[];
  ctrSeries?: number[];
}

/** Deterministic lifecycle from EVIDENCE (not age alone). */
export function creativeLifecycle(input: LifecycleInput): { state: CreativeLifecycle; reasons: string[] } {
  const now = input.now ?? Date.now();
  const p = input.creative.performance;
  const first = input.creative.firstSeen ? Date.parse(input.creative.firstSeen) : undefined;
  const ageDays = first ? (now - first) / 86_400_000 : undefined;
  const impressions = p.impressions ?? 0;
  const conv = Math.round(p.conversions ?? 0);
  const recentDelivery = input.deliverySeries ? input.deliverySeries.slice(-3).reduce((a, b) => a + b, 0) : undefined;
  const reasons: string[] = [];

  if (input.creative.active === false) { reasons.push('inactive'); return { state: 'RETIRED', reasons }; }
  if (recentDelivery === 0) { reasons.push('no recent delivery'); return { state: 'DORMANT', reasons }; }
  if (impressions < 1000 || conv < 5) { reasons.push('little accumulated data'); return { state: ageDays != null && ageDays < 3 ? 'NEW' : 'LEARNING', reasons }; }
  // Declining if a trend engine says the recent CTR is a persistent down move.
  if (input.ctrSeries && input.ctrSeries.length >= 7) {
    const t = classifyTrend(input.ctrSeries);
    if (t.direction === 'down' && (t.state === 'PERSISTENT_TREND' || t.state === 'STRUCTURAL_SHIFT')) { reasons.push('persistent CTR decline'); return { state: 'DECLINING', reasons }; }
  }
  reasons.push('sufficient data, stable delivery');
  return { state: 'MATURE', reasons };
}

export interface CreativeContext { currency?: string; objective?: string; country?: string; attributionBasis?: string; window?: { start: string; end: string } }

/** Gate before comparing two creatives (or cohorts). Hard blockers → NOT_COMPARABLE. */
export function creativeComparability(a: CreativeContext, b: CreativeContext): { state: Comparability; reasons: string[] } {
  const reasons: string[] = [];
  const hard: string[] = [];
  if (a.currency && b.currency && a.currency !== b.currency) hard.push('different currencies');
  if (a.objective && b.objective && a.objective !== b.objective) hard.push('different campaign objectives');
  if (a.window && b.window && (a.window.start !== b.window.start || a.window.end !== b.window.end)) reasons.push('different date windows');
  if ((a.country ?? null) !== (b.country ?? null)) reasons.push('different audiences/countries');
  if ((a.attributionBasis ?? null) !== (b.attributionBasis ?? null)) reasons.push('different attribution bases');
  if (hard.length) return { state: 'NOT_COMPARABLE', reasons: [...hard, ...reasons] };
  return { state: reasons.length ? 'PARTIALLY_COMPARABLE' : 'COMPARABLE', reasons };
}

export interface CreativeContributor { creativeId: string; metricDelta: number; sharePct: number }
export interface ContributionResult {
  contributors: CreativeContributor[];
  /** Whether the account/campaign move is better explained by creative perf or by a media-cost (CPM) change. */
  attribution: 'CREATIVE_DRIVEN' | 'MEDIA_COST_DRIVEN' | 'MIXED' | 'INSUFFICIENT_EVIDENCE';
  note: BiText;
}

/**
 * Which creatives explain a campaign metric movement — and crucially whether a CPM (media-cost) change
 * explains it instead of creative performance. Never blame the creative when CPM moved the number.
 */
export function creativeContribution(current: Creative[], previous: Creative[], metric: 'cpa' | 'roas' | 'conversions' | 'spend', cpmChangePct?: number): ContributionResult {
  const prevMap = new Map(previous.map((c) => [c.id, c]));
  const deltas: CreativeContributor[] = current.map((c) => {
    const to = (c.performance as Record<string, number | undefined>)[metric] ?? 0;
    const from = (prevMap.get(c.id)?.performance as Record<string, number | undefined> | undefined)?.[metric] ?? 0;
    return { creativeId: c.id, metricDelta: to - from, sharePct: 0 };
  });
  const totalAbs = deltas.reduce((a, d) => a + Math.abs(d.metricDelta), 0);
  for (const d of deltas) d.sharePct = totalAbs > 0 ? Math.round((Math.abs(d.metricDelta) / totalAbs) * 1000) / 10 : 0;
  deltas.sort((a, b) => Math.abs(b.metricDelta) - Math.abs(a.metricDelta));

  // An efficiency metric (CPA/ROAS) can move purely because the auction got cheaper/dearer (CPM). We
  // can only separate creative performance from media cost when CPM movement is KNOWN. If it is not
  // supplied for an efficiency metric, we do NOT assert creative causation — evidence is insufficient.
  const cpmKnown = cpmChangePct != null;
  const efficiencyMetric = metric === 'cpa' || metric === 'roas';
  let attribution: ContributionResult['attribution'];
  if (totalAbs === 0) attribution = 'INSUFFICIENT_EVIDENCE';
  else if (cpmKnown && Math.abs(cpmChangePct as number) >= 15 && efficiencyMetric) attribution = Math.abs(cpmChangePct as number) >= 30 ? 'MEDIA_COST_DRIVEN' : 'MIXED';
  else if (efficiencyMetric && !cpmKnown) attribution = 'INSUFFICIENT_EVIDENCE';
  else attribution = 'CREATIVE_DRIVEN';

  const note: BiText = attribution === 'MEDIA_COST_DRIVEN'
    ? { en: `The ${metric} move is largely explained by a ~${Math.round(cpmChangePct ?? 0)}% CPM (media-cost) change, not creative performance.`, ar: `يُفسَّر تحرّك ${metric} غالبًا بتغيّر في تكلفة الألف ظهور (~${Math.round(cpmChangePct ?? 0)}%) وليس بأداء الإعلان.` }
    : attribution === 'MIXED'
      ? { en: `Both a CPM (media-cost) change and creative performance contribute to the ${metric} move.`, ar: `يسهم كلٌّ من تغيّر تكلفة الوسائط وأداء الإعلان في تحرّك ${metric}.` }
      : attribution === 'CREATIVE_DRIVEN'
        ? (cpmKnown
          ? { en: `The ${metric} move is concentrated in specific creatives (media cost stable).`, ar: `يتركّز تحرّك ${metric} في إعلانات محددة (تكلفة الوسائط مستقرة).` }
          : { en: `The ${metric} move is concentrated in specific creatives (media-cost/CPM effect not assessed).`, ar: `يتركّز تحرّك ${metric} في إعلانات محددة (لم يُقيَّم أثر تكلفة الوسائط/CPM).` })
        : totalAbs === 0
          ? { en: 'No material creative-level movement to attribute.', ar: 'لا يوجد تحرّك جوهري على مستوى الإعلانات لإسناده.' }
          : { en: `CPM (media-cost) movement is unknown, so the ${metric} move cannot be separated between creative performance and media cost.`, ar: `تغيّر تكلفة الوسائط (CPM) غير معروف، لذا لا يمكن فصل تحرّك ${metric} بين أداء الإعلان وتكلفة الوسائط.` };
  return { contributors: deltas, attribution, note };
}

const LBL: Record<CreativeRating, BiText> = {
  PROMISING: { en: 'Promising', ar: 'واعد' },
  STRONG_PERFORMER: { en: 'Strong performer', ar: 'أداء قوي' },
  AVERAGE: { en: 'Average', ar: 'متوسط' },
  UNDERPERFORMING: { en: 'Underperforming', ar: 'أداء ضعيف' },
  INSUFFICIENT_DATA: { en: 'Insufficient data', ar: 'بيانات غير كافية' },
};
