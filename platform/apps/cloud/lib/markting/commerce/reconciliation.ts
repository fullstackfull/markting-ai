/**
 * Phase 5S/5T/5U/5V — PLATFORM vs MERCHANT reconciliation, merchant attribution views, and a strict
 * cross-currency guard.
 *
 * We never expect ad-platform attributed revenue to equal merchant recorded revenue — attribution
 * windows, view-through, cross-device, modelled conversions, refunds, payment failures, timezone and
 * currency differences, and tracking loss all cause legitimate variance. The reconciliation layer
 * classifies the gap rather than implying fraud or a bug. Attribution is deliberately conservative
 * (no fake multi-touch precision). Currencies are never summed without a governed FX layer.
 */
import type { CommerceMoney, Order, AcquisitionRef } from './model';

export type ReconciliationState = 'ALIGNED' | 'EXPECTED_VARIANCE' | 'MATERIAL_VARIANCE' | 'NOT_COMPARABLE' | 'INSUFFICIENT_DATA';

/** How reliable the variance classification is given the order count behind it. */
export type SampleSufficiency = 'LOW' | 'ADEQUATE' | 'UNKNOWN';

/**
 * Platform-vs-merchant variance is inherently noisier at low order volume (attribution windows,
 * view-through, modelling — all enumerated below — swamp a handful of orders). Below this count a
 * large % gap is weak evidence of a SYSTEMATIC variance, so the classification is marked LOW-sample so
 * consumers can caveat it rather than alarm on it (reassessment data-science P1 #4).
 */
export const MIN_ORDERS_FOR_RELIABLE_VARIANCE = 25;
/** Below this count the thresholds themselves widen (a 3-order account must not read as MATERIAL). */
const MIN_ORDERS_BEFORE_WIDENING = 5;

export interface ReconciliationResult {
  state: ReconciliationState;
  platformRevenue?: CommerceMoney;
  merchantRevenue?: CommerceMoney;
  differenceMinor?: number;         // merchant − platform (same currency only)
  differencePct?: number;
  currency?: string;
  /** Order count behind the comparison, and whether it is enough to trust the classification. */
  merchantOrderCount?: number;
  sampleSufficiency: SampleSufficiency;
  possibleExplanations: string[];
  reasons: string[];
}

const EXPLANATIONS = [
  'attribution window differences', 'cross-device conversions', 'view-through conversions',
  'duplicate platform events', 'refunds not reflected in platform value', 'payment failures counted by platform',
  'timezone boundary differences', 'currency differences', 'consent/tracking loss', 'platform conversion modelling',
];

/**
 * Compare ad-platform attributed revenue with merchant recorded revenue for the same window. Hard
 * blockers (different currency, missing data) short-circuit; otherwise the % gap sets the state.
 */
export function reconcile(input: {
  platformRevenue?: CommerceMoney;
  merchantRevenue?: CommerceMoney;
  merchantOrderCount?: number;
  expectedVariancePct?: number;     // default 15% is "expected"
  materialVariancePct?: number;     // default 35% is "material"
}): ReconciliationResult {
  const baseExpected = input.expectedVariancePct ?? 15;
  const baseMaterial = input.materialVariancePct ?? 35;
  if (!input.platformRevenue || !input.merchantRevenue) {
    return { state: 'INSUFFICIENT_DATA', sampleSufficiency: 'UNKNOWN', possibleExplanations: [], reasons: ['missing platform or merchant revenue for the window'] };
  }
  if (input.platformRevenue.currency !== input.merchantRevenue.currency) {
    return { state: 'NOT_COMPARABLE', sampleSufficiency: 'UNKNOWN', possibleExplanations: ['currency differences'], reasons: ['platform and merchant revenue are in different currencies (no governed FX)'], currency: undefined };
  }
  const orderCount = input.merchantOrderCount;
  if ((orderCount ?? 1) === 0) {
    return { state: 'INSUFFICIENT_DATA', sampleSufficiency: 'LOW', merchantOrderCount: 0, possibleExplanations: [], reasons: ['no merchant orders in the window'] };
  }
  // Widen the thresholds for very small samples so a handful of orders with a large % gap is not
  // classified MATERIAL on noise alone. The widening is 0 at/above MIN_ORDERS_BEFORE_WIDENING, so the
  // normal (n ≥ 5) classification is unchanged; it grows as the count falls below it.
  const widen = orderCount != null && orderCount < MIN_ORDERS_BEFORE_WIDENING
    ? 1 + (MIN_ORDERS_BEFORE_WIDENING - orderCount) / MIN_ORDERS_BEFORE_WIDENING
    : 1;
  const expected = Math.round(baseExpected * widen * 10) / 10;
  const material = Math.round(baseMaterial * widen * 10) / 10;
  const sampleSufficiency: SampleSufficiency = orderCount == null ? 'UNKNOWN'
    : orderCount < MIN_ORDERS_FOR_RELIABLE_VARIANCE ? 'LOW' : 'ADEQUATE';

  const p = input.platformRevenue.minorUnits;
  const m = input.merchantRevenue.minorUnits;
  const diff = m - p;
  const base = Math.max(Math.abs(p), Math.abs(m), 1);
  const pct = Math.round((Math.abs(diff) / base) * 1000) / 10;
  const state: ReconciliationState = pct <= expected ? (pct <= expected / 3 ? 'ALIGNED' : 'EXPECTED_VARIANCE') : pct <= material ? 'EXPECTED_VARIANCE' : 'MATERIAL_VARIANCE';
  const reasons = [`|Δ| = ${pct}% of the larger figure (expected ≤ ${expected}%, material > ${material}%)`];
  if (sampleSufficiency === 'LOW') reasons.push(`low sample (${orderCount} orders < ${MIN_ORDERS_FOR_RELIABLE_VARIANCE}) — variance classification is weak evidence; caveat before acting`);
  return {
    state,
    platformRevenue: input.platformRevenue,
    merchantRevenue: input.merchantRevenue,
    differenceMinor: diff,
    differencePct: Math.round((diff / base) * 1000) / 10,
    currency: input.merchantRevenue.currency,
    merchantOrderCount: orderCount,
    sampleSufficiency,
    possibleExplanations: state === 'ALIGNED' ? [] : EXPLANATIONS,
    reasons,
  };
}

// ---- Merchant attribution views (5U) — conservative, no fake multi-touch precision ----
export type AttributionView = 'DIRECTLY_TAGGED' | 'PLATFORM_REPORTED' | 'MERCHANT_LAST_TOUCH' | 'UNATTRIBUTED' | 'UNKNOWN';

/**
 * Classify an order's attribution conservatively from merchant-side signals only. A provider click id
 * (hashed) is the strongest merchant-side signal (DIRECTLY_TAGGED); UTM/referrer is MERCHANT_LAST_TOUCH
 * (NOT deterministic); nothing → UNATTRIBUTED. We never imply deterministic attribution from UTM alone.
 */
export function attributionView(acq: AcquisitionRef | undefined): { view: AttributionView; evidence: string[] } {
  if (!acq) return { view: 'UNKNOWN', evidence: [] };
  const evidence: string[] = [];
  if (acq.clickIdHashes && Object.keys(acq.clickIdHashes).length > 0) { evidence.push('provider click id present (hashed)'); return { view: 'DIRECTLY_TAGGED', evidence }; }
  if (acq.utmSource || acq.utmMedium || acq.utmCampaign) { evidence.push('utm present (last-touch, not deterministic)'); return { view: 'MERCHANT_LAST_TOUCH', evidence }; }
  if (acq.referrer || acq.landingPage) { evidence.push('referrer/landing only'); return { view: 'MERCHANT_LAST_TOUCH', evidence }; }
  if (acq.anonymous) return { view: 'UNATTRIBUTED', evidence: ['anonymous order'] };
  return { view: 'UNKNOWN', evidence: [] };
}

export function attributionBreakdown(orders: Order[]): Record<AttributionView, number> {
  const out: Record<AttributionView, number> = { DIRECTLY_TAGGED: 0, PLATFORM_REPORTED: 0, MERCHANT_LAST_TOUCH: 0, UNATTRIBUTED: 0, UNKNOWN: 0 };
  for (const o of orders) out[attributionView(o.acquisition).view] += 1;
  return out;
}

// ---- Cross-currency guard (5V) ----
export interface FxRate { from: string; to: string; rate: number; source: string; asOf: string }

/**
 * Compare/sum two money figures. Same currency → direct. Different currency → NOT_COMPARABLE UNLESS a
 * governed FxRate is supplied (with source + timestamp). A model-supplied rate is NEVER accepted here;
 * the caller must pass a governed rate explicitly.
 */
export function compareMoney(a: CommerceMoney, b: CommerceMoney, fx?: FxRate): { comparable: boolean; reason?: string; bInA?: CommerceMoney } {
  if (a.currency === b.currency) return { comparable: true };
  if (!fx) return { comparable: false, reason: `NOT_COMPARABLE: ${a.currency} vs ${b.currency} with no governed FX rate` };
  if (!(fx.from === b.currency && fx.to === a.currency)) return { comparable: false, reason: `FX rate ${fx.from}->${fx.to} does not convert ${b.currency}->${a.currency}` };
  // Convert b into a's currency using the governed rate (rate stored with source+timestamp upstream).
  return { comparable: true, bInA: { minorUnits: Math.round(b.minorUnits * fx.rate), currency: a.currency } };
}
