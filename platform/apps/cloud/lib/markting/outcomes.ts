/**
 * Phase 3B/3C — deterministic outcome engine. Captures a structured BEFORE baseline and an AFTER
 * window and classifies the result WITHOUT forcing success/failure and WITHOUT claiming causality.
 * A post-change improvement is at most OUTCOME_ALIGNED_WITH_RECOMMENDATION — never
 * "the recommendation caused it" — unless an experiment supports causation (not in Phase 3).
 * Contamination (another budget change, a separate pause, an attribution/currency change, a tracking
 * break, too short a window) yields CONTAMINATED, not a fabricated verdict.
 */
import type { DataTier } from './data-trust';
import { MIN_SAMPLE_FOR_CONFIDENCE } from './data-trust';
import type { CanonicalMetric } from './intelligence/model';
import type { BiText, RecommendationCategory } from './intelligence/decision-model';

export const OUTCOME_CLASSES = ['OUTCOME_PENDING', 'POSITIVE', 'NEGATIVE', 'NEUTRAL', 'INCONCLUSIVE', 'INSUFFICIENT_DATA', 'CONTAMINATED'] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

export const CAUSAL_STANCES = ['NOT_ESTABLISHED', 'OUTCOME_ALIGNED_WITH_RECOMMENDATION', 'TEMPORAL_ASSOCIATION', 'CAUSAL_EXPERIMENT_SUPPORTED'] as const;
export type CausalStance = (typeof CAUSAL_STANCES)[number];

export const CONTAMINATION_TYPES = ['major_budget_change', 'separate_pause', 'attribution_changed', 'promotion_started', 'tracking_broke', 'insufficient_window', 'currency_changed', 'reporting_basis_changed'] as const;
export type ContaminationType = (typeof CONTAMINATION_TYPES)[number];
export interface ContaminationFlag { type: ContaminationType; detail?: string }

export interface OutcomeSnapshot {
  entityId: string;
  entityLevel: string;
  accountId: string;
  window: { start: string; end: string };
  currency?: string;
  attributionBasis?: string;
  timezone?: string;
  trust: DataTier;
  complete: boolean;
  /** Base + derived metrics the window exposes. */
  metrics: Partial<Record<CanonicalMetric, number>>;
  /** Conversions behind the ratios (sample size). */
  sampleSize?: number;
}

export interface OutcomeInput {
  recommendationId: string;
  category: RecommendationCategory;
  windowLabel: string;
  before: OutcomeSnapshot;
  after: OutcomeSnapshot;
  /** External events observed in the window that would confound the read. */
  contaminationSignals?: ContaminationFlag[];
  /** The human changed the accepted recommendation's parameters (3N). */
  modified?: boolean;
  /** Material move threshold (percent) for POSITIVE/NEGATIVE vs NEUTRAL. */
  materialPct?: number;
}

export interface OutcomeResult {
  classification: OutcomeClass;
  primaryMetric: CanonicalMetric;
  /** Beneficial direction for the primary metric given the recommendation category. */
  expectedDirection: 'up' | 'down';
  actualDirection: 'up' | 'down' | 'flat';
  method: string;
  contamination: ContaminationFlag[];
  causalStance: CausalStance;
  trust: DataTier;
  before: { value: number | null; window: { start: string; end: string } };
  after: { value: number | null; window: { start: string; end: string } };
  conclusion: BiText;
}

/** Primary metric + the direction that is BENEFICIAL for it, per recommendation category. */
const CATEGORY_PRIMARY: Record<RecommendationCategory, { metric: CanonicalMetric; better: 'up' | 'down' }> = {
  BUDGET_REVIEW: { metric: 'roas', better: 'up' },
  PAUSE_REVIEW: { metric: 'cpa', better: 'down' },
  DELIVERY_REVIEW: { metric: 'conversions', better: 'up' },
  TRACKING_REVIEW: { metric: 'conversions', better: 'up' },
  CREATIVE_REVIEW: { metric: 'ctr', better: 'up' },
  TARGET_REVIEW: { metric: 'roas', better: 'up' },
  FUNNEL_REVIEW: { metric: 'conversions', better: 'up' },
  ANOMALY_REVIEW: { metric: 'spend', better: 'down' },
  DATA_QUALITY_REVIEW: { metric: 'conversions', better: 'up' },
};

function pct(from: number, to: number): number | undefined {
  if (!Number.isFinite(from) || from === 0) return undefined;
  return ((to - from) / Math.abs(from)) * 100;
}
const lowTrust = (t: DataTier) => t === 'SYNTHETIC' || t === 'UNVERIFIED';

export function evaluateOutcome(input: OutcomeInput): OutcomeResult {
  const material = input.materialPct ?? 10;
  const { metric, better } = CATEGORY_PRIMARY[input.category];
  const beforeVal = input.before.metrics[metric] ?? null;
  const afterVal = input.after.metrics[metric] ?? null;
  const base = {
    primaryMetric: metric, expectedDirection: better, trust: input.after.trust as DataTier,
    before: { value: beforeVal, window: input.before.window }, after: { value: afterVal, window: input.after.window },
    method: `before/after ${metric} comparison over labelled window ${input.windowLabel}`,
  };
  const contamination: ContaminationFlag[] = [...(input.contaminationSignals ?? [])];
  // Structural contamination the engine detects itself.
  if (input.before.currency && input.after.currency && input.before.currency !== input.after.currency) contamination.push({ type: 'currency_changed', detail: `${input.before.currency}→${input.after.currency}` });
  if ((input.before.attributionBasis ?? null) !== (input.after.attributionBasis ?? null)) contamination.push({ type: 'attribution_changed', detail: `${input.before.attributionBasis ?? 'unknown'}→${input.after.attributionBasis ?? 'unknown'}` });

  // Order of resolution: contamination → insufficient data → classify. Never force success/failure.
  if (contamination.length > 0) {
    return { ...base, classification: 'CONTAMINATED', actualDirection: 'flat', contamination, causalStance: 'NOT_ESTABLISHED',
      conclusion: { en: `Outcome not readable: the window was confounded (${contamination.map((c) => c.type).join(', ')}). No success/failure claimed.`, ar: `تعذّرت قراءة النتيجة: تلوّثت الفترة (${contamination.map((c) => c.type).join('، ')}). لا يُدّعى نجاح أو فشل.` } };
  }
  if (lowTrust(input.after.trust) || input.after.complete === false || (input.after.sampleSize ?? 0) < MIN_SAMPLE_FOR_CONFIDENCE || (input.before.sampleSize ?? 0) < MIN_SAMPLE_FOR_CONFIDENCE || afterVal == null || beforeVal == null) {
    return { ...base, classification: 'INSUFFICIENT_DATA', actualDirection: 'flat', contamination, causalStance: 'NOT_ESTABLISHED',
      conclusion: { en: `Not enough trustworthy post-action data to judge the outcome.`, ar: `لا توجد بيانات كافية وموثوقة بعد الإجراء للحكم على النتيجة.` } };
  }

  const changePct = pct(beforeVal, afterVal);
  const actualDirection: 'up' | 'down' | 'flat' = changePct == null || Math.abs(changePct) < material ? 'flat' : changePct > 0 ? 'up' : 'down';
  let classification: OutcomeClass;
  if (actualDirection === 'flat') classification = 'NEUTRAL';
  else if (actualDirection === better) classification = 'POSITIVE';
  else classification = 'NEGATIVE';
  // If the metric moved but the recommendation's expected direction is ambiguous for this data, prefer
  // INCONCLUSIVE over a confident label. (Here we keep it simple: a clear move classifies.)

  // Causal restraint: alignment, never causation (no experiment backing it).
  const causalStance: CausalStance = classification === 'POSITIVE' || classification === 'NEGATIVE' ? 'OUTCOME_ALIGNED_WITH_RECOMMENDATION' : 'NOT_ESTABLISHED';
  const aligned = classification === 'POSITIVE' ? 'improved' : classification === 'NEGATIVE' ? 'worsened' : 'was flat';
  const alignedAr = classification === 'POSITIVE' ? 'تحسّن' : classification === 'NEGATIVE' ? 'تراجع' : 'ظل ثابتًا';
  const changeTxt = changePct == null ? '' : `${Math.abs(Math.round(changePct))}% `;
  const changeTxtAr = changePct == null ? '' : `بنسبة ${Math.abs(Math.round(changePct))}% `;
  return {
    ...base, classification, actualDirection, contamination, causalStance,
    conclusion: {
      en: `${metric.toUpperCase()} ${aligned} ${changeTxt}after the change${input.modified ? ' (parameters were human-modified)' : ''}. This is temporal alignment with the recommendation, not proven causation.`,
      ar: `${metric.toUpperCase()} ${alignedAr} ${changeTxtAr}بعد التغيير${input.modified ? ' (عُدّلت المعاملات يدويًا)' : ''}. هذا توافق زمني مع التوصية وليس سببية مُثبتة.`,
    },
  };
}

/**
 * Observation windows per recommendation category (3B) — NOT one universal window. Efficiency/creative
 * reads need time for conversions to mature; a tracking fix can be checked sooner. Provider/conversion
 * delay can extend these (callers may override). Returns ordered labels the scheduler will enqueue.
 */
export function recommendedWindows(category: RecommendationCategory): string[] {
  switch (category) {
    case 'TRACKING_REVIEW':
    case 'DATA_QUALITY_REVIEW':
    case 'ANOMALY_REVIEW':
      return ['24h', '3d'];
    case 'CREATIVE_REVIEW':
    case 'DELIVERY_REVIEW':
    case 'FUNNEL_REVIEW':
      return ['3d', '7d'];
    case 'BUDGET_REVIEW':
    case 'PAUSE_REVIEW':
    case 'TARGET_REVIEW':
      return ['3d', '7d', '14d'];
    default:
      return ['7d'];
  }
}

export function windowToMs(label: string): number {
  const m = /^(\d+)(h|d)$/.exec(label);
  if (!m) return 7 * 86_400_000;
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3_600_000 : n * 86_400_000;
}
