/**
 * Phase 2F/2G — deterministic scaling readiness and downscale/pause candidacy. Nothing here executes
 * and nothing produces an automatic percentage. Scaling asks: is there enough trustworthy evidence
 * that performance is good, stable and target-backed to warrant a HUMAN reviewing a scale-up?
 * Downscale asks the mirror question and never pauses on one simplistic rule. Low spend is explicitly
 * NOT treated as poor performance.
 */
import { MIN_SAMPLE_FOR_CONFIDENCE, type DataTier } from '../data-trust';
import type { BiText, DownscaleState, ScalingState } from './decision-model';

export interface ScalingInput {
  spend: number;
  conversions: number;
  /** Performance vs target: ratio of actual to target (e.g. actualRoas/targetRoas). >1 is good for ROAS. */
  performanceVsTarget?: { metric: 'roas' | 'cpa'; actual: number; target: number; targetKnown: boolean };
  /** Recent stability: coefficient-of-variation-like flag the caller computes from the trend engine. */
  recentlyStable?: boolean;
  dataTrust: DataTier;
  fresh: boolean;
  windowComplete: boolean;
  /** Budget utilization fraction (spend/budget), when a budget is configured. */
  budgetUtilization?: number;
  attributionReliable?: boolean;
  /** Minimum conversions to even consider scaling (business-configurable; defaults to the ratio floor). */
  minConversions?: number;
}

export interface ScalingResult { state: ScalingState; reasons: string[]; label: BiText; metTargets: boolean }

export function evaluateScalingReadiness(input: ScalingInput): ScalingResult {
  const minConv = input.minConversions ?? MIN_SAMPLE_FOR_CONFIDENCE;
  const reasons: string[] = [];

  // Not evaluable: synthetic/unverified data, stale, incomplete window, or no evidence of performance.
  if (input.dataTrust === 'SYNTHETIC' || input.dataTrust === 'UNVERIFIED') reasons.push('data tier too low to evaluate scaling');
  if (!input.fresh) reasons.push('data is stale');
  if (!input.windowComplete) reasons.push('reporting window is still open');
  if (reasons.length) return { state: 'NOT_EVALUABLE', reasons, label: lbl('NOT_EVALUABLE'), metTargets: false };

  // Evidence sufficiency for scaling.
  if (input.conversions < minConv) reasons.push(`only ${Math.round(input.conversions)} conversions (< ${minConv}) — not enough to trust the efficiency read`);
  if (input.attributionReliable === false) reasons.push('attribution basis is not reliable');
  if (input.recentlyStable === false) reasons.push('recent performance is not stable');

  const met = targetMet(input.performanceVsTarget);
  if (input.performanceVsTarget && !input.performanceVsTarget.targetKnown) reasons.push('no configured target; readiness is vs baseline only');
  if (input.performanceVsTarget && met === false) reasons.push('performance is not beating target');

  if (reasons.length) {
    // If the only gaps are soft (no target / baseline-only), it may still be POTENTIALLY_READY.
    const hard = reasons.some((r) => r.includes('conversions') || r.includes('attribution') || r.includes('not stable') || r.includes('not beating target'));
    return { state: hard ? 'NOT_READY' : 'POTENTIALLY_READY', reasons, label: lbl(hard ? 'NOT_READY' : 'POTENTIALLY_READY'), metTargets: met === true };
  }
  // Everything supports it — still only READY_FOR_HUMAN_REVIEW (never auto-scale).
  return { state: 'READY_FOR_HUMAN_REVIEW', reasons: ['sufficient spend + conversions, stable, meeting target, fresh trustworthy data'], label: lbl('READY_FOR_HUMAN_REVIEW'), metTargets: met === true };
}

function targetMet(p?: ScalingInput['performanceVsTarget']): boolean | undefined {
  if (!p || !p.targetKnown || !(p.target > 0)) return undefined;
  return p.metric === 'roas' ? p.actual >= p.target : p.actual <= p.target; // ROAS higher is better; CPA lower is better
}

export interface DownscaleInput {
  spend: number;
  conversions: number;
  performanceVsTarget?: { metric: 'roas' | 'cpa'; actual: number; target: number; targetKnown: boolean };
  /** Trend direction over the observation window (from the trend engine). */
  trendWorsening?: boolean;
  observationDays: number;
  dataTrust: DataTier;
  /** Marked important by configured business context — raises the review bar. */
  strategicallyImportant?: boolean;
  minConversions?: number;
}

export interface DownscaleResult { state: DownscaleState; reasons: string[]; label: BiText }

export function evaluateDownscaleCandidacy(input: DownscaleInput): DownscaleResult {
  const minConv = input.minConversions ?? MIN_SAMPLE_FOR_CONFIDENCE;
  const reasons: string[] = [];

  // Low spend is NOT poor performance — a low-spend campaign is observed, never prematurely cut.
  if (input.spend <= 0) return { state: 'OBSERVE', reasons: ['no spend yet — observe, do not cut'], label: lbl2('OBSERVE') };

  // Insufficient observation window or sample → cannot be a strong candidate; observe/review only.
  const thin = input.conversions < minConv || input.observationDays < 7 || input.dataTrust === 'SYNTHETIC' || input.dataTrust === 'UNVERIFIED';

  const met = targetMet(input.performanceVsTarget);
  const missingTarget = input.performanceVsTarget && input.performanceVsTarget.targetKnown && met === false;

  let score = 0;
  if (missingTarget) { score += 2; reasons.push('missing performance target'); }
  if (input.trendWorsening) { score += 1; reasons.push('performance trend is worsening'); }
  if (input.conversions === 0 && input.spend > 0) { score += 2; reasons.push('spend with zero conversions over the window'); }
  if (input.strategicallyImportant) { score -= 1; reasons.push('strategically important — higher bar before cutting'); }

  let state: DownscaleState;
  if (thin || score <= 0) state = 'OBSERVE';
  else if (score === 1 || score === 2) state = 'REVIEW';
  else state = 'STRONG_REVIEW_CANDIDATE';
  if (thin && score > 2) reasons.push('capped at OBSERVE/REVIEW: observation window or sample is too thin for a strong call');
  if (reasons.length === 0) reasons.push('no material concern — keep observing');
  return { state, reasons, label: lbl2(state) };
}

const SCALE_LABELS: Record<ScalingState, BiText> = {
  NOT_EVALUABLE: { en: 'Not evaluable', ar: 'غير قابل للتقييم' },
  NOT_READY: { en: 'Not ready to scale', ar: 'غير جاهز للتوسيع' },
  POTENTIALLY_READY: { en: 'Potentially ready — needs more evidence', ar: 'قد يكون جاهزًا — يحتاج أدلة أكثر' },
  READY_FOR_HUMAN_REVIEW: { en: 'Ready for human review', ar: 'جاهز لمراجعة بشرية' },
};
const DOWNSCALE_LABELS: Record<DownscaleState, BiText> = {
  OBSERVE: { en: 'Observe', ar: 'مراقبة' },
  REVIEW: { en: 'Review', ar: 'مراجعة' },
  STRONG_REVIEW_CANDIDATE: { en: 'Strong review candidate', ar: 'مرشّح قوي للمراجعة' },
};
function lbl(s: ScalingState): BiText { return SCALE_LABELS[s]; }
function lbl2(s: DownscaleState): BiText { return DOWNSCALE_LABELS[s]; }
