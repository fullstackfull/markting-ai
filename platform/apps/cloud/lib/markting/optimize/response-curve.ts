/**
 * Phase 6M/6N/6O — spend-response foundation. NO fake ML. We estimate SIMPLE, auditable spend→outcome
 * behavior only where evidence supports it, always with an explicit validity range we refuse to
 * extrapolate beyond. Saturation is a SIGNAL (never "proven" without strong evidence). Marginal metrics
 * require sufficient historical variation, never two arbitrary points.
 */
import type { BiText } from '../intelligence/decision-model';

export interface ResponsePoint { spendMinor: number; conversions?: number; revenueMinor?: number }

export type CurveForm = 'LOCAL_LINEAR' | 'DIMINISHING_RETURNS' | 'MONOTONIC_BOUNDED' | 'INSUFFICIENT_EVIDENCE';

export interface ResponseCurve {
  form: CurveForm;
  /** Slope of conversions per extra unit of spend (minor), within the validity range. */
  marginalConversionsPerMinor?: number;
  evidenceWindow: { points: number };
  sampleSize: number;                 // total conversions behind the fit
  fitQuality: 'LOW' | 'MEDIUM' | 'HIGH';
  validityRange?: { minSpendMinor: number; maxSpendMinor: number };
  limitations: string[];
  currency?: string;
}

const MIN_POINTS = 4;
const MIN_SAMPLE = 30;

/**
 * Fit a simple response relationship from observed (spend, conversions) points. Requires ≥ MIN_POINTS
 * distinct spend levels and ≥ MIN_SAMPLE total conversions; otherwise INSUFFICIENT_EVIDENCE. The
 * validity range is the observed spend span — callers must NOT extrapolate beyond it.
 */
export function fitResponseCurve(points: ResponsePoint[], currency?: string): ResponseCurve {
  const clean = points.filter((p) => p.spendMinor > 0 && p.conversions != null).sort((a, b) => a.spendMinor - b.spendMinor);
  const sample = clean.reduce((a, p) => a + (p.conversions ?? 0), 0);
  const distinctSpend = new Set(clean.map((p) => p.spendMinor)).size;
  const limitations: string[] = [];
  if (distinctSpend < MIN_POINTS || sample < MIN_SAMPLE) {
    return { form: 'INSUFFICIENT_EVIDENCE', evidenceWindow: { points: clean.length }, sampleSize: sample, fitQuality: 'LOW', limitations: [`need ≥ ${MIN_POINTS} spend levels and ≥ ${MIN_SAMPLE} conversions (have ${distinctSpend}/${sample})`], currency };
  }
  // Marginal conversions between consecutive points.
  const marginals: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const dS = clean[i]!.spendMinor - clean[i - 1]!.spendMinor;
    const dC = (clean[i]!.conversions ?? 0) - (clean[i - 1]!.conversions ?? 0);
    if (dS > 0) marginals.push(dC / dS);
  }
  const avgSlope = marginals.reduce((a, b) => a + b, 0) / marginals.length;
  // Diminishing returns: later marginals meaningfully lower than earlier ones.
  const firstHalf = marginals.slice(0, Math.ceil(marginals.length / 2));
  const secondHalf = marginals.slice(Math.ceil(marginals.length / 2));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const diminishing = avg(secondHalf) < avg(firstHalf) * 0.7;
  const monotonic = marginals.every((m) => m >= -1e-9);
  const form: CurveForm = diminishing ? 'DIMINISHING_RETURNS' : monotonic ? 'LOCAL_LINEAR' : 'MONOTONIC_BOUNDED';
  const fitQuality: ResponseCurve['fitQuality'] = sample >= 100 && distinctSpend >= 6 ? 'HIGH' : sample >= 50 ? 'MEDIUM' : 'LOW';
  limitations.push('simple empirical fit — not a causal model; valid only within the observed spend range');
  // For a DIMINISHING_RETURNS curve the average slope OVERSTATES the incremental response near the top
  // of the range, so we expose the CONSERVATIVE local (last-segment) marginal — projecting a scale-up
  // with the average slope would be optimistic exactly where scaling is most tempting.
  const localSlope = marginals[marginals.length - 1] ?? avgSlope;
  const reportedSlope = form === 'DIMINISHING_RETURNS' ? Math.min(avgSlope, localSlope) : avgSlope;
  if (form === 'DIMINISHING_RETURNS') limitations.push('diminishing returns — marginal uses the conservative last-segment slope, not the average');
  return {
    form,
    marginalConversionsPerMinor: reportedSlope,
    evidenceWindow: { points: clean.length },
    sampleSize: sample,
    fitQuality,
    validityRange: { minSpendMinor: clean[0]!.spendMinor, maxSpendMinor: clean[clean.length - 1]!.spendMinor },
    limitations,
    currency,
  };
}

/** Refuse to project outside the validity range (no extrapolation). */
export function withinValidity(curve: ResponseCurve, spendMinor: number): boolean {
  return !!curve.validityRange && spendMinor >= curve.validityRange.minSpendMinor && spendMinor <= curve.validityRange.maxSpendMinor;
}

// ---- Saturation (6N) ----
export type SaturationState = 'NO_SIGNAL' | 'SATURATION_SIGNAL' | 'STRONG_SATURATION_SIGNAL';

export interface SaturationResult { state: SaturationState; signals: string[]; label: BiText }

/**
 * Detect potential saturation from multiple weak signals (never a single metric). STRONG only when the
 * core pair (weakening marginal conversions + worsening CPA) holds AND at least one corroborator.
 */
export function detectSaturation(input: {
  spendRising?: boolean; marginalConversionsWeakening?: boolean; cpaWorsening?: boolean;
  roasDeteriorating?: boolean; frequencyRising?: boolean; reachGrowthSlowing?: boolean;
}): SaturationResult {
  const signals: string[] = [];
  if (input.spendRising) signals.push('spend_rising');
  if (input.marginalConversionsWeakening) signals.push('marginal_conversions_weakening');
  if (input.cpaWorsening) signals.push('cpa_worsening');
  if (input.roasDeteriorating) signals.push('roas_deteriorating');
  if (input.frequencyRising) signals.push('frequency_rising');
  if (input.reachGrowthSlowing) signals.push('reach_growth_slowing');
  const core = !!input.marginalConversionsWeakening && !!input.cpaWorsening;
  const corroborators = ['roas_deteriorating', 'frequency_rising', 'reach_growth_slowing'].filter((s) => signals.includes(s)).length;
  let state: SaturationState;
  if (core && corroborators >= 1) state = 'STRONG_SATURATION_SIGNAL';
  else if (signals.includes('marginal_conversions_weakening') || signals.includes('cpa_worsening') || core) state = 'SATURATION_SIGNAL';
  else state = 'NO_SIGNAL';
  const LBL: Record<SaturationState, BiText> = {
    NO_SIGNAL: { en: 'No saturation signal', ar: 'لا إشارة تشبّع' },
    SATURATION_SIGNAL: { en: 'Saturation signal (not proven)', ar: 'إشارة تشبّع (غير مثبتة)' },
    STRONG_SATURATION_SIGNAL: { en: 'Strong saturation signal (not proven)', ar: 'إشارة تشبّع قوية (غير مثبتة)' },
  };
  return { state, signals, label: LBL[state] };
}

// ---- Marginal metrics (6O) ----
export interface MarginalResult { marginalCpa?: number; marginalRoas?: number; reason?: string }

/**
 * Marginal CPA/ROAS from two windows — ONLY with sufficient spend variation and conversions in each.
 * Never computed from two arbitrary points; warns when spend change is immaterial.
 */
export function marginalMetrics(prev: ResponsePoint, next: ResponsePoint, opts: { minSpendDeltaPct?: number; minConversions?: number } = {}): MarginalResult {
  const minPct = opts.minSpendDeltaPct ?? 15;
  const minConv = opts.minConversions ?? MIN_SAMPLE;
  const dS = next.spendMinor - prev.spendMinor;
  const dC = (next.conversions ?? 0) - (prev.conversions ?? 0);
  const dV = (next.revenueMinor ?? 0) - (prev.revenueMinor ?? 0);
  if (prev.spendMinor <= 0 || Math.abs(dS) / prev.spendMinor < minPct / 100) return { reason: `spend change < ${minPct}% — marginal metric not meaningful` };
  if ((next.conversions ?? 0) < minConv) return { reason: `fewer than ${minConv} conversions in the later window` };
  if (dC <= 0) return { reason: 'no marginal conversions gained (or lost) — marginal CPA undefined/negative' };
  return { marginalCpa: dS / dC, marginalRoas: dS !== 0 ? dV / dS : undefined };
}
