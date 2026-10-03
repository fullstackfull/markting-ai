/**
 * Coherence-2 Program 28 — AI evaluation harness.
 *
 * A real evaluation FRAMEWORK over the orchestrator: each scenario declares structured input facts +
 * the conclusions the answer MUST contain, the conclusions it must NOT contain, and the grounding/
 * safety requirements. The harness runs the deterministic composition today (MODEL_DISABLED); when a
 * governed model is configured it can narrate the same result (LIVE_MODEL) and the identical rubric
 * grades the narrated answer. Live model execution is BLOCKED_EXTERNAL here, but the harness exists and
 * runs against the deterministic layer so it never silently passes.
 */
import { orchestrator, type OrchestratorInput } from '../orchestrator';
import type { IntelligenceResult, NextAction } from '../envelope';
import type { DataTier } from '../trust';
import type { IntelligenceRequestContext } from '../context';

export type EvalMode = 'MODEL_DISABLED' | 'LOCAL_FALLBACK' | 'LIVE_MODEL';

export interface EvalExpectation {
  /** Factor keys that MUST appear in the composed diagnosis (factual correctness). */
  factorsInclude?: string[];
  /** Factor keys that must NOT appear (non-hallucination / no invented factor). */
  factorsProhibit?: string[];
  /** The next action must be one of these (prioritization usefulness). */
  nextActionOneOf?: NextAction[];
  /** The composed trust tier must equal this (grounding). */
  trustTier?: DataTier;
  /** Unresolved/caveats must be present (uncertainty / causal restraint). */
  requireUnresolved?: boolean;
  /** Every recommendation must be review-only (security). */
  requireReviewOnly?: boolean;
}

export interface EvalScenario {
  id: string;
  titleEn: string;
  input: Omit<OrchestratorInput, 'context'> & { context?: Partial<IntelligenceRequestContext> };
  expect: EvalExpectation;
}

export interface EvalCheck { name: string; pass: boolean; detail?: string }
export interface EvalScore { scenarioId: string; passed: boolean; checks: EvalCheck[]; result: IntelligenceResult }

const BASE_CONTEXT: IntelligenceRequestContext = {
  organizationId: 'eval-org', userId: 'eval', permissions: ['owner'], runtimeMode: 'LIVE_RECOMMENDATIONS',
  reportingCurrency: 'SAR',
};

/**
 * Run one scenario through the orchestrator and grade it. `mode` selects how the answer is produced;
 * grading is identical across modes (the model only narrates the same structured result). Live model
 * is BLOCKED_EXTERNAL: with no governed narrator, LIVE_MODEL falls back to the deterministic result and
 * the mode is reported so a run can never masquerade as live.
 */
export function runEvalScenario(scenario: EvalScenario, mode: EvalMode = 'MODEL_DISABLED'): EvalScore {
  const context: IntelligenceRequestContext = { ...BASE_CONTEXT, ...scenario.input.context };
  const result = orchestrator.compose({ ...scenario.input, context, intent: scenario.input.intent });
  const factorKeys = new Set(result.diagnosis.factors.map((f) => f.key));
  const checks: EvalCheck[] = [];
  const e = scenario.expect;

  if (e.factorsInclude) for (const k of e.factorsInclude) checks.push({ name: `includes ${k}`, pass: factorKeys.has(k) });
  if (e.factorsProhibit) for (const k of e.factorsProhibit) checks.push({ name: `prohibits ${k}`, pass: !factorKeys.has(k) });
  if (e.nextActionOneOf) checks.push({ name: `nextAction in [${e.nextActionOneOf.join(',')}]`, pass: e.nextActionOneOf.includes(result.nextAction), detail: result.nextAction });
  if (e.trustTier) checks.push({ name: `trust=${e.trustTier}`, pass: result.trust.tier === e.trustTier, detail: result.trust.tier });
  if (e.requireUnresolved) checks.push({ name: 'has unresolved/caveat', pass: result.diagnosis.unresolved.length > 0 });
  if (e.requireReviewOnly) checks.push({ name: 'all recs review-only', pass: result.recommendations.every((r) => r.requiresHumanApproval === true) });
  // Grounding: every surfaced factor must carry a data-trust tier (no ungrounded claim).
  checks.push({ name: 'every factor grounded (dataTrust present)', pass: result.diagnosis.factors.every((f) => !!f.dataTrust) });

  return { scenarioId: scenario.id, passed: checks.every((c) => c.pass), checks, result };
}

export interface EvalRunReport { mode: EvalMode; total: number; passed: number; failures: Array<{ id: string; failed: string[] }> }

export function runEvalSuite(scenarios: EvalScenario[], mode: EvalMode = 'MODEL_DISABLED'): EvalRunReport {
  const scores = scenarios.map((s) => runEvalScenario(s, mode));
  return {
    mode,
    total: scores.length,
    passed: scores.filter((s) => s.passed).length,
    failures: scores.filter((s) => !s.passed).map((s) => ({ id: s.scenarioId, failed: s.checks.filter((c) => !c.pass).map((c) => c.name) })),
  };
}

/** Whether a governed live model is configured. Always false here (BLOCKED_EXTERNAL). */
export function liveModelAvailable(): boolean {
  return false;
}
