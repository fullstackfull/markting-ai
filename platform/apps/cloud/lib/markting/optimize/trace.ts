/**
 * Phase 6 — OPTIMIZATION TRACE. Every optimization/allocation result must be auditable: a user asks
 * "why did MARKTING recommend this allocation?" and gets inputs, constraints, calculations, assumptions,
 * outputs, uncertainty, and evidence back. The LLM does NOT perform the core math; this trace is the
 * deterministic record of the arithmetic the engine actually ran.
 */
import type { BiText } from '../intelligence/decision-model';
import type { AllocationResult } from './allocation';
import type { HardConstraints, SoftConstraints } from './constraints';

export interface OptimizationTrace {
  inputs: Record<string, unknown>;
  constraints: { hard: HardConstraints; soft: SoftConstraints };
  calculations: string[];           // human-readable step list (deterministic)
  assumptions: string[];
  outputs: Record<string, unknown>;
  uncertainty: BiText;
  evidence: string[];
  engine: 'deterministic_greedy';
}

/** Build an audit trace for an allocation result. */
export function traceAllocation(input: {
  request: { mode: string; amountMinor: number; currency: string; candidateCount: number };
  hard: HardConstraints; soft: SoftConstraints; result: AllocationResult; evidence?: string[];
}): OptimizationTrace {
  const calculations = [
    `mode=${input.result.mode}; amount=${input.request.amountMinor} ${input.request.currency}; candidates=${input.request.candidateCount}`,
    `engine=deterministic_greedy; candidates sorted by transparent scale-priority score`,
    `moved=${input.result.totalMovedMinor} across ${input.result.moves.length} candidate(s); unallocated=${input.result.unallocatedMinor}`,
    ...input.result.moves.map((m) => `${m.candidateId}: ${m.direction} ${m.deltaMinor} (${m.fromMinor}→${m.toMinor}) conf=${m.confidence} flags=[${m.flags.join(',')}]`),
  ];
  const assumptions = [
    'projections (if any) assume the response relationship holds only within its observed validity range',
    'revenue projections assume constant AOV (stated explicitly where used)',
    'hard constraints are inviolable; soft preferences only reorder within them',
  ];
  return {
    inputs: { mode: input.request.mode, amountMinor: input.request.amountMinor, currency: input.request.currency, candidateCount: input.request.candidateCount },
    constraints: { hard: input.hard, soft: input.soft },
    calculations,
    assumptions,
    outputs: { moves: input.result.moves, unallocatedMinor: input.result.unallocatedMinor, notes: input.result.notes },
    uncertainty: { en: 'Outputs are review proposals, not guarantees; confidence per move reflects evidence, saturation, creative, inventory and attribution signals.', ar: 'المخرجات مقترحات للمراجعة وليست ضمانات؛ تعكس الثقة لكل حركة أدلّة الإشباع والإبداع والمخزون والإسناد.' },
    evidence: input.evidence ?? [],
    engine: 'deterministic_greedy',
  };
}
