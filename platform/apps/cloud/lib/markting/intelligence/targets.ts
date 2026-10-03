/**
 * Phase 2K — target / goal engine. Performance vs historical BASELINE is not the same as performance
 * vs business OBJECTIVE, and the system must know which it is speaking about. Targets come only from
 * configured business context (KNOWN/CONFIGURED/DERIVED); when a target is absent it is UNKNOWN and no
 * goal is invented.
 */
import type { BusinessContext, Provenance } from '../business-context';
import type { KnownTargets } from './context';

export type TargetStatus = Provenance;

/** Resolve the business targets into the context-builder shape, preserving provenance as status. */
export function resolveTargets(ctx: BusinessContext): KnownTargets {
  const out: KnownTargets = {};
  if (ctx.targetCpa.value != null) out.targetCpa = { value: ctx.targetCpa.value, currency: ctx.reportingCurrency.value ?? undefined, status: ctx.targetCpa.provenance };
  if (ctx.targetRoas.value != null) out.targetRoas = { value: ctx.targetRoas.value, status: ctx.targetRoas.provenance };
  if (ctx.dailyBudget.value != null) out.dailyBudget = { value: ctx.dailyBudget.value, currency: ctx.reportingCurrency.value ?? undefined, status: ctx.dailyBudget.provenance };
  return out;
}

export type TargetGap = 'TARGET_BEAT' | 'TARGET_MISS' | 'TARGET_ON' | 'UNKNOWN';

/**
 * Compare an actual metric against its configured target. ROAS higher-is-better; CPA lower-is-better.
 * Returns UNKNOWN when no target is configured — never fabricates a goal.
 */
export function evaluateTargetGap(metric: 'roas' | 'cpa', actual: number, target: { value: number; status: TargetStatus } | undefined, tolerancePct = 5): { gap: TargetGap; deltaPct?: number; targetKnown: boolean } {
  if (!target || target.status === 'UNKNOWN' || !(target.value > 0)) return { gap: 'UNKNOWN', targetKnown: false };
  const deltaPct = ((actual - target.value) / target.value) * 100;
  const within = Math.abs(deltaPct) <= tolerancePct;
  let gap: TargetGap;
  if (within) gap = 'TARGET_ON';
  else if (metric === 'roas') gap = actual > target.value ? 'TARGET_BEAT' : 'TARGET_MISS';
  else gap = actual < target.value ? 'TARGET_BEAT' : 'TARGET_MISS';
  return { gap, deltaPct: Math.round(deltaPct * 10) / 10, targetKnown: true };
}
