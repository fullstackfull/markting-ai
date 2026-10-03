import 'server-only';
import { db } from '@/lib/db';
import type { Experiment } from './experiment-model';
import type { AllocationResult } from './allocation';
import type { OptimizationTrace } from './trace';
import type { HardConstraints, SoftConstraints } from './constraints';

/**
 * Phase 6 — tenant-scoped persistence for experiments, optimization scenarios, constraints, and human
 * review decisions. REVIEW storage only: a scenario decision records a human review status, never an
 * execution (execution goes through the Phase-0 preview/approval path). Every write asserts the
 * server-derived organizationId BEFORE the DB call, so a payload can never write cross-tenant.
 */

export async function saveExperiment(organizationId: string, e: Experiment): Promise<void> {
  if (e.organizationId && e.organizationId !== organizationId) throw new Error('experiment organization mismatch');
  await db()`
    insert into public.markting_experiments
      (id, organization_id, workspace_id, hypothesis, control, treatment, primary_metric, secondary_metrics, guardrail_metrics,
       type, study_type, assignment_method, provider, account_id, entity_scope, observation_window_days, sample_requirement,
       confidence_method, contamination_flags, conclusion, recommendation_ref, start_at, planned_end_at, actual_end_at, status, confidence)
    values
      (gen_random_uuid(), ${organizationId}, ${e.workspaceId ?? null}, ${e.hypothesis.statement.en}, ${db().json(e.control as never)}, ${db().json(e.treatment as never)}, ${e.primaryMetric}, ${db().json(e.secondaryMetrics as never)}, ${db().json(e.guardrailMetrics as never)},
       ${e.type}, ${e.studyType}, ${e.assignmentMethod}, ${e.provider ?? null}, ${e.accountId ?? null}, ${e.entityScope ?? null}, ${e.observationWindowDays}, ${db().json(e.sampleRequirement as never)},
       ${e.confidenceMethod}, ${db().json(e.contaminationFlags as never)}, ${e.conclusion ? db().json(e.conclusion as never) : null}, ${e.recommendationRef ?? null}, ${e.startDate ?? null}, ${e.plannedEndDate ?? null}, ${e.actualEndDate ?? null}, ${e.status}, ${null})`;
}

export async function listExperiments(organizationId: string): Promise<Array<Record<string, unknown>>> {
  return db()<Array<Record<string, unknown>>>`
    select * from public.markting_experiments where organization_id = ${organizationId} order by created_at desc limit 2000`;
}

export async function saveScenario(organizationId: string, input: {
  scenarioId: string; workspaceId?: string; mode: 'ALLOCATE_EXTRA' | 'REDUCE' | 'SIMULATE'; currency: string;
  request: unknown; result: AllocationResult | unknown; trace: OptimizationTrace; hard?: HardConstraints; soft?: SoftConstraints;
}): Promise<void> {
  await db()`
    insert into public.markting_optimization_scenarios (scenario_id, organization_id, workspace_id, mode, currency, request, result, trace, created_at)
    values (${input.scenarioId}, ${organizationId}, ${input.workspaceId ?? null}, ${input.mode}, ${input.currency}, ${db().json(input.request as never)}, ${db().json(input.result as never)}, ${db().json(input.trace as never)}, now())
    on conflict (organization_id, scenario_id) do update set request = excluded.request, result = excluded.result, trace = excluded.trace`;
  if (input.hard) await db()`
    insert into public.markting_scenario_constraints (organization_id, scenario_id, kind, payload)
    values (${organizationId}, ${input.scenarioId}, 'hard', ${db().json(input.hard as never)})
    on conflict (organization_id, scenario_id, kind) do update set payload = excluded.payload`;
  if (input.soft) await db()`
    insert into public.markting_scenario_constraints (organization_id, scenario_id, kind, payload)
    values (${organizationId}, ${input.scenarioId}, 'soft', ${db().json(input.soft as never)})
    on conflict (organization_id, scenario_id, kind) do update set payload = excluded.payload`;
}

export async function getScenario(organizationId: string, scenarioId: string): Promise<Record<string, unknown> | null> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select * from public.markting_optimization_scenarios where organization_id = ${organizationId} and scenario_id = ${scenarioId} limit 1`;
  return rows[0] ?? null;
}

export async function listScenarios(organizationId: string, limit = 200): Promise<Array<Record<string, unknown>>> {
  return db()<Array<Record<string, unknown>>>`
    select scenario_id, mode, currency, created_at from public.markting_optimization_scenarios where organization_id = ${organizationId} order by created_at desc limit ${limit}`;
}

/** Record a HUMAN review decision on a scenario option. Never an execution — review status only. */
export async function saveScenarioDecision(organizationId: string, input: { scenarioId: string; optionKind: string; decision: unknown; reviewStatus?: 'PROPOSED' | 'UNDER_REVIEW' | 'ACCEPTED_FOR_PREVIEW' | 'REJECTED' }): Promise<void> {
  await db()`
    insert into public.markting_scenario_decisions (organization_id, scenario_id, option_kind, decision, review_status)
    values (${organizationId}, ${input.scenarioId}, ${input.optionKind}, ${db().json(input.decision as never)}, ${input.reviewStatus ?? 'PROPOSED'})`;
}
