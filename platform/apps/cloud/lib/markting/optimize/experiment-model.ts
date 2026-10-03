/**
 * Phase 6A–6D — canonical EXPERIMENT model, types, structured hypothesis, and control/treatment design.
 *
 * Experiments are DESIGNED and REVIEWED here; nothing launches automatically. A "before/after" look is
 * never dressed up as a randomized experiment — the study type is classified honestly and the causal
 * strength is never exaggerated.
 */
import type { BiText } from '../intelligence/decision-model';

export const EXPERIMENT_STATUSES = [
  'DRAFT', 'READY_FOR_REVIEW', 'APPROVED_FOR_LAUNCH', 'RUNNING', 'PAUSED',
  'COMPLETED', 'INVALIDATED', 'INCONCLUSIVE', 'CANCELLED',
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_TYPES = [
  'BUDGET_INCREASE', 'BUDGET_DECREASE', 'CREATIVE_TEST', 'HOOK_TEST', 'ANGLE_TEST',
  'LANDING_PAGE_TEST', 'AUDIENCE_TEST', 'PLACEMENT_TEST', 'BID_STRATEGY_REVIEW', 'CAMPAIGN_STRUCTURE_REVIEW',
] as const;
export type ExperimentType = (typeof EXPERIMENT_TYPES)[number];

/** Honest study-type classification — a before/after is never silently treated as randomized. */
export const STUDY_TYPES = ['RANDOMIZED', 'PLATFORM_EXPERIMENT', 'QUASI_EXPERIMENTAL', 'BEFORE_AFTER', 'OBSERVATIONAL'] as const;
export type StudyType = (typeof STUDY_TYPES)[number];

/** Causal strength hierarchy — observational before/after is NEVER causal proof. */
export const CAUSAL_EVIDENCE = ['OBSERVATIONAL_ASSOCIATION', 'TEMPORAL_ASSOCIATION', 'QUASI_EXPERIMENTAL_EVIDENCE', 'RANDOMIZED_EVIDENCE'] as const;
export type CausalEvidence = (typeof CAUSAL_EVIDENCE)[number];

export const ASSIGNMENT_METHODS = ['platform_split', 'geo_split', 'time_split', 'cell_split', 'none_observational'] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];

/** A structured hypothesis — never vague. */
export interface Hypothesis {
  statement: BiText;
  metric: string;
  expectedDirection: 'increase' | 'decrease' | 'no_change';
  scope: { provider?: string; accountId?: string; campaignId?: string; entityLevel?: 'account' | 'campaign' | 'ad_group' | 'ad' };
  assumptions: string[];
  knownRisks: string[];
  minimumEvidence: BiText;
}

export interface ControlArm { label: string; definition: BiText; holdConstant: string[] }
export interface TreatmentArm { label: string; definition: BiText; change: BiText }

export interface SampleRequirement {
  minConversionsPerArm: number;
  minSpendPerArm?: { minorUnits: number; currency: string };
  minImpressionsPerArm?: number;
  minDurationDays: number;
  minimumDetectableEffectPct?: number;
  baselineRate?: number;
}

export interface Experiment {
  experimentId: string;
  organizationId: string;
  workspaceId?: string;
  type: ExperimentType;
  studyType: StudyType;
  assignmentMethod: AssignmentMethod;
  hypothesis: Hypothesis;
  provider?: string;
  accountId?: string;
  entityScope?: string;
  control: ControlArm;
  treatment: TreatmentArm;
  primaryMetric: string;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  startDate?: string;
  plannedEndDate?: string;
  actualEndDate?: string;
  status: ExperimentStatus;
  observationWindowDays: number;
  sampleRequirement: SampleRequirement;
  confidenceMethod: 'deterministic_sufficiency' | 'platform_reported' | 'none';
  contaminationFlags: string[];
  outcome?: unknown;
  conclusion?: BiText;
  recommendationRef?: string;
}

/** The study type a design can honestly claim from its assignment method. */
export function studyTypeFor(method: AssignmentMethod, platformExperiment = false): StudyType {
  if (platformExperiment) return 'PLATFORM_EXPERIMENT';
  switch (method) {
    case 'platform_split': return 'RANDOMIZED';
    case 'geo_split': case 'cell_split': return 'QUASI_EXPERIMENTAL';
    case 'time_split': return 'BEFORE_AFTER';
    case 'none_observational': return 'OBSERVATIONAL';
  }
}

/** The strongest causal claim a study type may support (never stronger). */
export function causalCeiling(study: StudyType): CausalEvidence {
  switch (study) {
    case 'RANDOMIZED': return 'RANDOMIZED_EVIDENCE';
    case 'PLATFORM_EXPERIMENT': return 'RANDOMIZED_EVIDENCE';
    case 'QUASI_EXPERIMENTAL': return 'QUASI_EXPERIMENTAL_EVIDENCE';
    case 'BEFORE_AFTER': return 'TEMPORAL_ASSOCIATION';
    case 'OBSERVATIONAL': return 'OBSERVATIONAL_ASSOCIATION';
  }
}

/** Which experiment types are feasible given available data/platform capabilities. */
export function feasibleExperimentTypes(caps: {
  hasCreativeData?: boolean; hasAudienceData?: boolean; supportsPlatformSplit?: boolean;
  hasLandingPageData?: boolean; hasSpendResponse?: boolean;
}): ExperimentType[] {
  const out: ExperimentType[] = [];
  if (caps.hasSpendResponse) out.push('BUDGET_INCREASE', 'BUDGET_DECREASE');
  if (caps.hasCreativeData) out.push('CREATIVE_TEST', 'HOOK_TEST', 'ANGLE_TEST');
  if (caps.hasLandingPageData) out.push('LANDING_PAGE_TEST'); // observational planning only
  if (caps.hasAudienceData) out.push('AUDIENCE_TEST', 'PLACEMENT_TEST');
  out.push('BID_STRATEGY_REVIEW', 'CAMPAIGN_STRUCTURE_REVIEW');
  return out;
}

export function experimentId(organizationId: string, type: ExperimentType, scope: string, nonce: string): string {
  return `exp:${type.toLowerCase()}:${scope}:${nonce}`;
}
