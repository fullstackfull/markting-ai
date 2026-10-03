/**
 * Phase 5Z — TARGET PROFITABILITY configuration. Organizations configure target MER, blended CAC,
 * contribution margin, gross margin, and payback. Targets carry provenance and effective dates so a
 * historical target change stays traceable (reusing the Phase-3 memory service, which versions and
 * trust-classifies writes). Targets are facts configured by humans — never set by a model or payload.
 */
import type { CommerceMoney } from './model';

export interface ProfitabilityTargets {
  targetMer?: { basis: 'gross' | 'net' | 'contribution'; value: number };
  targetBlendedCac?: CommerceMoney;
  targetContributionMarginPct?: number;
  targetGrossMarginPct?: number;
  paybackDays?: number;
  effectiveFrom: string;
  provenance: { source: 'human_config' | 'human_confirmation'; setBy?: string };
}

export const TARGETS_MEMORY_CATEGORY = 'explicit_fact' as const;
export const TARGETS_MEMORY_KEY = 'commerce_profitability_targets';

/** Evaluate a measured metric against a configured target, returning a conservative verdict. */
export type TargetVerdict = 'ABOVE_TARGET' | 'ON_TARGET' | 'BELOW_TARGET' | 'NO_TARGET' | 'NOT_COMPARABLE';

export function evaluateMerTarget(measured: { basis: string; value?: number }, targets?: ProfitabilityTargets): TargetVerdict {
  if (!targets?.targetMer) return 'NO_TARGET';
  if (targets.targetMer.basis !== measured.basis) return 'NOT_COMPARABLE'; // bases must match (gross≠net≠contribution)
  if (measured.value == null) return 'NOT_COMPARABLE';
  const t = targets.targetMer.value;
  if (measured.value >= t * 1.05) return 'ABOVE_TARGET';
  if (measured.value <= t * 0.95) return 'BELOW_TARGET';
  return 'ON_TARGET';
}

export function evaluateMarginTarget(measuredPct: number | undefined, targetPct?: number): TargetVerdict {
  if (targetPct == null) return 'NO_TARGET';
  if (measuredPct == null) return 'NOT_COMPARABLE';
  if (measuredPct >= targetPct + 2) return 'ABOVE_TARGET';
  if (measuredPct <= targetPct - 2) return 'BELOW_TARGET';
  return 'ON_TARGET';
}

export function evaluateCacTarget(measured: CommerceMoney | undefined, target?: CommerceMoney): TargetVerdict {
  if (!target) return 'NO_TARGET';
  if (!measured) return 'NOT_COMPARABLE';
  if (measured.currency !== target.currency) return 'NOT_COMPARABLE';
  if (measured.minorUnits <= target.minorUnits * 0.95) return 'ABOVE_TARGET'; // lower CAC is better
  if (measured.minorUnits >= target.minorUnits * 1.05) return 'BELOW_TARGET';
  return 'ON_TARGET';
}
