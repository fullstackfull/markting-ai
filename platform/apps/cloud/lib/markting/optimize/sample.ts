/**
 * Phase 6E — DETERMINISTIC sample-sufficiency rules. The LLM never invents a sample size; these are
 * fixed, conservative thresholds over conversions / spend / impressions / duration / baseline rate /
 * minimum detectable effect. Insufficient inputs → EXPERIMENT_NOT_READY with explicit reasons.
 */
import { MIN_SAMPLE_FOR_CONFIDENCE } from '../data-trust';
import type { SampleRequirement } from './experiment-model';

export type SampleReadiness = 'READY' | 'EXPERIMENT_NOT_READY' | 'NOT_EVALUABLE';

export interface SampleObserved {
  conversionsPerArm?: number;
  spendPerArm?: { minorUnits: number; currency: string };
  impressionsPerArm?: number;
  durationDays?: number;
}

export interface SampleVerdict {
  readiness: SampleReadiness;
  reasons: string[];
  /** A deterministic, transparent estimate of conversions needed per arm (not an LLM guess). */
  requiredConversionsPerArm: number;
}

/**
 * A simple, transparent per-arm conversion requirement from baseline rate + minimum detectable effect.
 * Uses a conservative fixed-constant approximation (16·p(1−p)/(mde·p)^2-style) rather than a real power
 * calc — documented as an approximation, never presented as an exact power analysis.
 */
export function requiredConversionsPerArm(req: SampleRequirement): number {
  const explicit = req.minConversionsPerArm ?? 0;
  if (req.baselineRate && req.minimumDetectableEffectPct) {
    const p = Math.min(Math.max(req.baselineRate, 1e-4), 0.5);
    const mde = req.minimumDetectableEffectPct / 100;
    // conversions ≈ 16 / (mde^2 · p)  — conservative approximation; larger of this and the floor.
    const approx = Math.ceil(16 / (mde * mde * p));
    return Math.max(explicit, approx, MIN_SAMPLE_FOR_CONFIDENCE);
  }
  return Math.max(explicit, MIN_SAMPLE_FOR_CONFIDENCE);
}

export function assessSample(req: SampleRequirement, observed: SampleObserved): SampleVerdict {
  const needConv = requiredConversionsPerArm(req);
  const reasons: string[] = [];
  if (observed.conversionsPerArm == null && observed.spendPerArm == null) {
    return { readiness: 'NOT_EVALUABLE', reasons: ['no observed sample inputs'], requiredConversionsPerArm: needConv };
  }
  if ((observed.conversionsPerArm ?? 0) < needConv) reasons.push(`conversions/arm ${observed.conversionsPerArm ?? 0} < required ${needConv}`);
  if (req.minSpendPerArm && observed.spendPerArm) {
    if (observed.spendPerArm.currency !== req.minSpendPerArm.currency) reasons.push('spend currency differs from requirement (not comparable)');
    else if (observed.spendPerArm.minorUnits < req.minSpendPerArm.minorUnits) reasons.push(`spend/arm below required ${req.minSpendPerArm.minorUnits} ${req.minSpendPerArm.currency}`);
  }
  if (req.minImpressionsPerArm && (observed.impressionsPerArm ?? 0) < req.minImpressionsPerArm) reasons.push(`impressions/arm below required ${req.minImpressionsPerArm}`);
  if ((observed.durationDays ?? 0) < req.minDurationDays) reasons.push(`duration ${observed.durationDays ?? 0}d < required ${req.minDurationDays}d`);
  return { readiness: reasons.length ? 'EXPERIMENT_NOT_READY' : 'READY', reasons, requiredConversionsPerArm: needConv };
}
