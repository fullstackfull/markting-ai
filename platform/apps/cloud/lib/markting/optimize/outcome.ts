/**
 * Phase 6 — EXPERIMENT OUTCOME engine. Reuses the Phase-3 outcome logic and layers experiment validity
 * + the causal ceiling on top, so an experiment RESULT is distinguished from a recommendation RESULT
 * and never over-claims causality (a before/after experiment can reach at most TEMPORAL_ASSOCIATION).
 */
import { evaluateOutcome, type OutcomeInput, type OutcomeResult, CAUSAL_STANCES, type CausalStance } from '../outcomes';
import { classifyExperimentValidity, type ExperimentContaminationSignal, type ExperimentValidity } from './contamination';
import { causalCeiling, type StudyType, type CausalEvidence } from './experiment-model';
import type { BiText } from '../intelligence/decision-model';

/** The strongest CausalStance a study's causal ceiling permits. */
const CEILING_MAX_STANCE: Record<CausalEvidence, CausalStance> = {
  OBSERVATIONAL_ASSOCIATION: 'OUTCOME_ALIGNED_WITH_RECOMMENDATION',
  TEMPORAL_ASSOCIATION: 'TEMPORAL_ASSOCIATION',
  QUASI_EXPERIMENTAL_EVIDENCE: 'TEMPORAL_ASSOCIATION',
  RANDOMIZED_EVIDENCE: 'CAUSAL_EXPERIMENT_SUPPORTED',
};

/** Clamp a stance so it never exceeds the study design's causal ceiling (enforced, not coincidental). */
function clampStance(stance: CausalStance, ceiling: CausalEvidence): CausalStance {
  const max = CEILING_MAX_STANCE[ceiling];
  return CAUSAL_STANCES.indexOf(stance) <= CAUSAL_STANCES.indexOf(max) ? stance : max;
}

export interface ExperimentOutcome {
  resultKind: 'EXPERIMENT_RESULT';
  validity: ExperimentValidity;
  outcome: OutcomeResult;
  /** The STRONGEST causal claim this study design can support — the result never exceeds it. */
  causalCeiling: CausalEvidence;
  conclusion: BiText;
}

export function evaluateExperimentOutcome(input: {
  studyType: StudyType;
  outcome: OutcomeInput;
  contaminationSignals?: ExperimentContaminationSignal[];
  windowComplete?: boolean;
  sampleSufficient?: boolean;
}): ExperimentOutcome {
  const validity = classifyExperimentValidity({ signals: input.contaminationSignals, windowComplete: input.windowComplete, sampleSufficient: input.sampleSufficient });
  const base = evaluateOutcome(input.outcome);
  const ceiling = causalCeiling(input.studyType);
  // If the experiment is not VALID, the outcome is not readable as a result regardless of the numbers.
  if (validity.validity !== 'VALID') {
    return { resultKind: 'EXPERIMENT_RESULT', validity: validity.validity, outcome: { ...base, classification: validity.validity === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'CONTAMINATED', causalStance: 'NOT_ESTABLISHED' }, causalCeiling: ceiling, conclusion: validity.conclusion };
  }
  // Enforce the ceiling on the stance rather than relying on evaluateOutcome to stay below it.
  const clamped: OutcomeResult = { ...base, causalStance: clampStance(base.causalStance, ceiling) };
  const conclusion: BiText = {
    en: `Experiment ${clamped.classification} (study type ${input.studyType}); strongest supportable causal claim: ${ceiling}.`,
    ar: `نتيجة التجربة ${clamped.classification} (نوع الدراسة ${input.studyType})؛ أقصى ادعاء سببي مدعوم: ${ceiling}.`,
  };
  return { resultKind: 'EXPERIMENT_RESULT', validity: 'VALID', outcome: clamped, causalCeiling: ceiling, conclusion };
}
