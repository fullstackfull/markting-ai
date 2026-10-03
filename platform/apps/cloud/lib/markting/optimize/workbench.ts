/**
 * Phase 6 — HUMAN DECISION WORKBENCH surfaces: the decision workbench, side-by-side scenario
 * comparison, and the experiment calendar. These are READ surfaces for a human reviewer; they carry NO
 * execution buttons and nothing bypasses the Phase-0 preview/approval path. Numbers avoid false
 * precision (tagged provenance from the simulator; direction/risk, not fabricated lift %).
 */
import type { BiText } from '../intelligence/decision-model';
import type { AllocationResult } from './allocation';
import type { DecisionOption } from './decision';
import type { ScenarioResult } from './simulate';
import type { Experiment } from './experiment-model';
import type { OptimizationRecommendation } from './recommendations';

export interface Workbench {
  proposedExperiments: Array<{ experimentId: string; type: string; status: string; hypothesis: BiText; studyType: string }>;
  budgetOpportunities: AllocationResult['moves'];
  riskySpend: Array<{ candidateId: string; reasons: string[] }>;
  saturationWatch: Array<{ candidateId: string; state: string }>;
  allocationScenarios: ScenarioResult[];
  guardrails: Array<{ metric: string; detail?: BiText }>;
  rollbackPlans: Array<{ ref: string; steps: BiText[] }>;
  /** No execution affordance — reviewer actions go through the Phase-0 preview/approval path only. */
  executionPath: 'phase0_preview_approval_only';
}

export function buildWorkbench(input: {
  experiments?: Experiment[];
  allocation?: AllocationResult;
  scenarios?: ScenarioResult[];
  saturation?: Array<{ candidateId: string; state: string }>;
  options?: DecisionOption[];
}): Workbench {
  const moves = input.allocation?.moves ?? [];
  return {
    proposedExperiments: (input.experiments ?? []).filter((e) => e.status === 'DRAFT' || e.status === 'READY_FOR_REVIEW').map((e) => ({ experimentId: e.experimentId, type: e.type, status: e.status, hypothesis: e.hypothesis.statement, studyType: e.studyType })),
    budgetOpportunities: moves.filter((m) => m.direction === 'UP_REVIEW'),
    riskySpend: moves.filter((m) => m.confidence === 'LOW' || m.flags.length > 0).map((m) => ({ candidateId: m.candidateId, reasons: m.reasons })),
    saturationWatch: (input.saturation ?? []).filter((s) => s.state !== 'NO_SIGNAL'),
    allocationScenarios: input.scenarios ?? [],
    guardrails: (input.options ?? []).flatMap((o) => o.guardrails.map((g) => ({ metric: g.metric }))),
    rollbackPlans: (input.options ?? []).map((o, i) => ({ ref: `${o.kind}-${i}`, steps: o.rollback.steps })),
    executionPath: 'phase0_preview_approval_only',
  };
}

// ---- Scenario comparison (side-by-side) ----
export interface ScenarioComparison {
  rows: Array<{ label: string; spend?: string; conversions?: string; cpa?: string; roas?: string; provenance: string }>;
  caveat: BiText;
}

function fmt(v?: number, p?: string): string { return v == null ? (p ?? 'UNKNOWN') : String(v); }

export function buildScenarioComparison(scenarios: ScenarioResult[]): ScenarioComparison {
  return {
    rows: scenarios.map((s) => ({
      label: s.label,
      spend: fmt(s.spend.value, s.spend.provenance),
      conversions: fmt(s.conversions.value, s.conversions.provenance),
      cpa: fmt(s.cpa.value, s.cpa.provenance),
      roas: fmt(s.roas.value, s.roas.provenance),
      provenance: [s.spend.provenance, s.conversions.provenance].join('/'),
    })),
    caveat: { en: 'PROJECTED values are model estimates within a validity range, not guarantees; UNKNOWN means it was not projected.', ar: 'القيم المتوقّعة تقديرات ضمن نطاق صلاحية وليست ضمانات؛ UNKNOWN يعني أنها لم تُتوقّع.' },
  };
}

// ---- Experiment calendar ----
export interface ExperimentCalendar {
  planned: Array<{ experimentId: string; plannedStart?: string }>;
  running: Array<{ experimentId: string; start?: string; observationEndsAt?: string }>;
  completed: Array<{ experimentId: string; end?: string }>;
  invalidated: Array<{ experimentId: string }>;
  note: BiText;
}

export function buildExperimentCalendar(experiments: Experiment[]): ExperimentCalendar {
  const addDays = (iso?: string, days = 0) => (iso ? new Date(Date.parse(iso) + days * 86_400_000).toISOString() : undefined);
  return {
    planned: experiments.filter((e) => e.status === 'APPROVED_FOR_LAUNCH' || e.status === 'READY_FOR_REVIEW').map((e) => ({ experimentId: e.experimentId, plannedStart: e.startDate })),
    running: experiments.filter((e) => e.status === 'RUNNING').map((e) => ({ experimentId: e.experimentId, start: e.startDate, observationEndsAt: addDays(e.startDate, e.observationWindowDays) })),
    completed: experiments.filter((e) => e.status === 'COMPLETED').map((e) => ({ experimentId: e.experimentId, end: e.actualEndDate })),
    invalidated: experiments.filter((e) => e.status === 'INVALIDATED').map((e) => ({ experimentId: e.experimentId })),
    note: { en: 'Launches are never scheduled automatically — a human approves each via the Phase-0 path.', ar: 'لا تُجدول الإطلاقات تلقائيًا — يعتمد كل إطلاق بشريًا عبر مسار المرحلة ٠.' },
  };
}
