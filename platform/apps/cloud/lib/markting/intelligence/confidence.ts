/**
 * Phase 2Q — deterministic confidence. The LLM never invents a confidence number. Confidence in a
 * DIAGNOSIS is derived from data factors: trust tier, freshness, sample size, window completeness,
 * signal strength, attribution consistency and target availability. We stay CATEGORICAL
 * (LOW/MEDIUM/HIGH) — a calibrated numeric model is Phase 3+ and would need outcome data we do not
 * have. The lowest contributing factor caps the result (evidence confidence never averages upward).
 */
import { MIN_SAMPLE_FOR_CONFIDENCE, type DataTier } from '../data-trust';
import { CONFIDENCE_RANK, minConfidence, type Confidence } from './decision-model';

export interface ConfidenceInputs {
  dataTrust: DataTier;
  sampleSize?: number;
  windowComplete?: boolean;
  /** True when a staleness bound was supplied and the data was within it (or no bound applies). */
  fresh?: boolean;
  /** |pct change| of the driving signal, when ratio/volume based. */
  signalStrengthPct?: number;
  /** True when both compared windows share the same attribution basis (or it is irrelevant). */
  attributionConsistent?: boolean;
  /** Whether a configured business target backs the judgement (vs baseline-only). */
  targetKnown?: boolean;
  /** Ratio-based judgements need sample; volume/absolute ones do not. */
  ratioBased?: boolean;
}

const TIER_CAP: Record<DataTier, Confidence> = {
  SYNTHETIC: 'LOW',
  UNVERIFIED: 'LOW',
  PLATFORM_REPORTED: 'MEDIUM',
  VALIDATED: 'HIGH',
  RECONCILED: 'HIGH',
};

/**
 * Derive categorical confidence. Each factor can only CAP (never raise above its ceiling); the final
 * value is the minimum across all caps. This makes "HIGH" mean every factor supported it.
 */
export function deriveConfidence(input: ConfidenceInputs): Confidence {
  const caps: Confidence[] = [TIER_CAP[input.dataTrust]];

  // Sample size (only when the judgement rests on a ratio).
  if (input.ratioBased) {
    const n = input.sampleSize ?? 0;
    if (n < MIN_SAMPLE_FOR_CONFIDENCE) caps.push('LOW');
    else if (n < MIN_SAMPLE_FOR_CONFIDENCE * 4) caps.push('MEDIUM');
    else caps.push('HIGH');
  }

  if (input.windowComplete === false) caps.push('LOW');
  if (input.fresh === false) caps.push('LOW');
  if (input.attributionConsistent === false) caps.push('LOW');

  // Signal strength: a barely-material move cannot be HIGH confidence on its own.
  if (input.signalStrengthPct != null) {
    const s = Math.abs(input.signalStrengthPct);
    if (s < 5) caps.push('LOW');
    else if (s < 15) caps.push('MEDIUM');
    else caps.push('HIGH');
  }

  // A judgement about performance-vs-objective is softer without a known target, but this only caps
  // at MEDIUM (baseline comparison can still be HIGH on its own terms).
  if (input.targetKnown === false) caps.push('MEDIUM');

  return minConfidence(...caps);
}

/** Convenience: is this confidence at least the given floor. */
export function atLeast(c: Confidence, floor: Confidence): boolean {
  return CONFIDENCE_RANK[c] >= CONFIDENCE_RANK[floor];
}
