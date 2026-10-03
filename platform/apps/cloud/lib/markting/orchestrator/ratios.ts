/**
 * Hardening Program 23 — canonical ratio-SAFETY layer for the analytical/display ratios.
 *
 * Every derived ratio the product shows (ROAS, MER, CTR, CVR, CPA, CAC, contribution margin, refund
 * rate, LTV) must degrade to an explicit UNKNOWN — with a machine-readable reason — rather than to a
 * silent 0, Infinity or NaN. The money-basis ratios (MER, blended CAC, margin, observed LTV) already
 * enforce this in lib/markting/commerce/* with their own typed `notComputableReason`. This module is
 * the shared primitive for the remaining count/rate ratios so the rule set is identical everywhere:
 *
 *   - zero / missing denominator        → UNKNOWN (ZERO_DENOMINATOR)
 *   - missing / non-finite numerator    → UNKNOWN (MISSING_INPUT)
 *   - operands in different currencies  → UNKNOWN (MIXED_CURRENCY)
 *   - operands from incompatible periods→ UNKNOWN (INCOMPATIBLE_PERIOD)
 *
 * It never clamps a real zero numerator to UNKNOWN: 0 purchases over 1000 impressions is CVR 0, a known
 * fact, not missing data. Only an unusable denominator or absent/incompatible inputs yield UNKNOWN.
 */
export type RatioReason =
  | 'ZERO_DENOMINATOR'
  | 'MISSING_INPUT'
  | 'MIXED_CURRENCY'
  | 'INCOMPATIBLE_PERIOD';

export type RatioResult =
  | { state: 'KNOWN'; value: number }
  | { state: 'UNKNOWN'; reason: RatioReason };

const KNOWN = (value: number): RatioResult => ({ state: 'KNOWN', value });
const UNKNOWN = (reason: RatioReason): RatioResult => ({ state: 'UNKNOWN', reason });

interface SafeRatioOptions {
  /** Round the KNOWN result to this many decimals (default 2). */
  decimals?: number;
  /** Multiply the quotient (e.g. 100 for a percentage). Applied before rounding. */
  scale?: number;
  /** Currencies of the operands, when they are monetary; a mismatch yields MIXED_CURRENCY. */
  numeratorCurrency?: string;
  denominatorCurrency?: string;
  /** Period keys of the operands; a mismatch yields INCOMPATIBLE_PERIOD. */
  numeratorPeriod?: string;
  denominatorPeriod?: string;
}

/**
 * The single safe-division primitive. Order of checks matters: incompatibility of the operands
 * (currency, period) is reported before the zero-denominator case so the surfaced reason is the most
 * specific one.
 */
export function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined, opts: SafeRatioOptions = {}): RatioResult {
  if (numerator == null || !Number.isFinite(numerator) || denominator == null || !Number.isFinite(denominator)) return UNKNOWN('MISSING_INPUT');
  if (opts.numeratorCurrency != null && opts.denominatorCurrency != null && opts.numeratorCurrency !== opts.denominatorCurrency) return UNKNOWN('MIXED_CURRENCY');
  if (opts.numeratorPeriod != null && opts.denominatorPeriod != null && opts.numeratorPeriod !== opts.denominatorPeriod) return UNKNOWN('INCOMPATIBLE_PERIOD');
  if (denominator === 0) return UNKNOWN('ZERO_DENOMINATOR');
  const scale = opts.scale ?? 1;
  const decimals = opts.decimals ?? 2;
  const factor = 10 ** decimals;
  return KNOWN(Math.round((numerator / denominator) * scale * factor) / factor);
}

/** ROAS = conversion value / spend (same currency). */
export const roas = (conversionValue: number | null | undefined, spend: number | null | undefined, currency?: string) =>
  safeRatio(conversionValue, spend, { numeratorCurrency: currency, denominatorCurrency: currency });

/** CTR % = clicks / impressions × 100. */
export const ctrPct = (clicks: number | null | undefined, impressions: number | null | undefined) =>
  safeRatio(clicks, impressions, { scale: 100 });

/** CVR % = conversions / clicks × 100. */
export const cvrPct = (conversions: number | null | undefined, clicks: number | null | undefined) =>
  safeRatio(conversions, clicks, { scale: 100 });

/** CPA = spend / conversions (same currency). */
export const cpa = (spend: number | null | undefined, conversions: number | null | undefined, currency?: string) =>
  safeRatio(spend, conversions, { numeratorCurrency: currency, denominatorCurrency: currency });

/** Refund rate % = refunded amount / gross amount × 100 (same currency). */
export const refundRatePct = (refunded: number | null | undefined, gross: number | null | undefined, currency?: string) =>
  safeRatio(refunded, gross, { scale: 100, numeratorCurrency: currency, denominatorCurrency: currency });

/** Render a RatioResult for display, using the locale's UNKNOWN label. */
export function ratioText(r: RatioResult, unknownLabel = 'UNKNOWN'): string {
  return r.state === 'KNOWN' ? String(r.value) : unknownLabel;
}
