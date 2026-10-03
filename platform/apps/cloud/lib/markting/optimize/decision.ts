/**
 * Phase 6V/6W/6X/6Y/6Z — risk-adjusted decisions, reversibility, multi-option plans, stop conditions,
 * and rollback plans. All review-only: options are proposals for a HUMAN and for governed execution
 * LATER; nothing here executes, and no rollback runs automatically in Phase 6.
 */
import type { BiText, Risk } from '../intelligence/decision-model';
import type { Guardrail } from './guardrails';

export type Reversibility = 'EASILY_REVERSIBLE' | 'REVERSIBLE_WITH_COST' | 'DIFFICULT_TO_REVERSE';

/** Classify how reversible a proposed action is (feeds the risk framework). */
export function classifyReversibility(action: {
  kind: 'daily_budget_adjust' | 'bid_adjust' | 'campaign_pause' | 'campaign_delete' | 'structure_change' | 'experiment_launch';
  magnitudePct?: number;
}): Reversibility {
  switch (action.kind) {
    case 'daily_budget_adjust': return (action.magnitudePct ?? 0) <= 25 ? 'EASILY_REVERSIBLE' : 'REVERSIBLE_WITH_COST';
    case 'bid_adjust': return 'EASILY_REVERSIBLE';
    case 'campaign_pause': return 'REVERSIBLE_WITH_COST'; // learning phase reset cost
    case 'experiment_launch': return 'REVERSIBLE_WITH_COST';
    case 'structure_change': return 'DIFFICULT_TO_REVERSE';
    case 'campaign_delete': return 'DIFFICULT_TO_REVERSE';
  }
}

export interface RiskAdjustment {
  upside: BiText;
  downside: BiText;
  uncertainty: 'LOW' | 'MEDIUM' | 'HIGH';
  reversibility: Reversibility;
  financialExposureMinor?: number;
  currency?: string;
  /** Categorical risk (calibrated numeric risk is deferred — we never fake a probability). */
  risk: Risk;
}

/** Derive categorical risk from exposure, reversibility, and uncertainty (deterministic, no fake %). */
export function riskAdjust(input: {
  upside: BiText; downside: BiText; uncertainty: 'LOW' | 'MEDIUM' | 'HIGH';
  reversibility: Reversibility; financialExposureMinor?: number; currency?: string; guardrailBreaches?: number;
}): RiskAdjustment {
  let level = 0;
  if (input.reversibility === 'DIFFICULT_TO_REVERSE') level += 2; else if (input.reversibility === 'REVERSIBLE_WITH_COST') level += 1;
  if (input.uncertainty === 'HIGH') level += 2; else if (input.uncertainty === 'MEDIUM') level += 1;
  if ((input.guardrailBreaches ?? 0) > 0) level += 2;
  const risk: Risk = level >= 5 ? 'CRITICAL' : level >= 3 ? 'HIGH' : level >= 1 ? 'MODERATE' : 'LOW';
  return { upside: input.upside, downside: input.downside, uncertainty: input.uncertainty, reversibility: input.reversibility, financialExposureMinor: input.financialExposureMinor, currency: input.currency, risk };
}

// ---- Stop conditions (6Y) ----
export interface StopCondition { metric: string; operator: '>' | '<'; threshold: number; note: BiText }

export function defaultStopConditions(targets: { cpaCeiling?: number; roasFloor?: number; marginFloorPct?: number; refundCeiling?: number; spendExposureMinor?: number }): StopCondition[] {
  const out: StopCondition[] = [];
  if (targets.cpaCeiling != null) out.push({ metric: 'cpa', operator: '>', threshold: targets.cpaCeiling, note: { en: 'Stop if CPA exceeds the ceiling.', ar: 'توقّف إذا تجاوزت CPA السقف.' } });
  if (targets.roasFloor != null) out.push({ metric: 'roas', operator: '<', threshold: targets.roasFloor, note: { en: 'Stop if ROAS falls below the floor.', ar: 'توقّف إذا هبطت ROAS تحت الحد.' } });
  if (targets.marginFloorPct != null) out.push({ metric: 'contribution_margin_pct', operator: '<', threshold: targets.marginFloorPct, note: { en: 'Stop if contribution margin falls below the floor.', ar: 'توقّف إذا هبط هامش المساهمة تحت الحد.' } });
  if (targets.refundCeiling != null) out.push({ metric: 'refund_rate', operator: '>', threshold: targets.refundCeiling, note: { en: 'Stop if the refund rate exceeds the ceiling.', ar: 'توقّف إذا تجاوز معدل الاسترداد السقف.' } });
  if (targets.spendExposureMinor != null) out.push({ metric: 'spend', operator: '>', threshold: targets.spendExposureMinor, note: { en: 'Stop if spend exceeds the exposure limit.', ar: 'توقّف إذا تجاوز الإنفاق حد التعرّض.' } });
  return out;
}

// ---- Rollback plan (6Z) ----
export interface RollbackPlan { steps: BiText[]; automatic: false }

export function rollbackPlan(action: { kind: string; previousBudgetMinor?: number; previousBid?: number; currency?: string }): RollbackPlan {
  const steps: BiText[] = [];
  if (action.previousBudgetMinor != null) steps.push({ en: `Restore the previous budget (${(action.previousBudgetMinor / 100).toFixed(2)} ${action.currency ?? ''}).`, ar: `استعد الميزانية السابقة (${(action.previousBudgetMinor / 100).toFixed(2)} ${action.currency ?? ''}).` });
  if (action.previousBid != null) steps.push({ en: 'Restore the previous bid.', ar: 'استعد العرض السابق.' });
  if (action.kind === 'experiment_launch') steps.push({ en: 'End the experiment and revert both arms to baseline.', ar: 'أنهِ التجربة وأعد المجموعتين إلى الأساس.' });
  steps.push({ en: 'Confirm metrics return toward the pre-change baseline before closing the rollback.', ar: 'تأكد من عودة المقاييس نحو الأساس قبل إغلاق التراجع.' });
  return { steps, automatic: false };
}

// ---- Decision options (6X) ----
export type OptionKind = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE_REVIEW';
export interface DecisionOption {
  kind: OptionKind;
  summary: BiText;
  budgetImpactMinor: number;
  currency: string;
  expectedDirection: 'POSITIVE_DIRECTION_EXPECTED' | 'NEGATIVE_RISK_REDUCTION' | 'UNCERTAIN' | 'NOT_ESTIMATED';
  risk: RiskAdjustment;
  guardrails: Guardrail[];
  stopConditions: StopCondition[];
  rollback: RollbackPlan;
}

/**
 * Build conservative / balanced / aggressive-review options for a proposed scale, ONLY when evidence
 * allows (no fabricated lift %). The aggressive option is omitted when evidence/uncertainty make it
 * irresponsible (returns only the options the evidence supports).
 */
export function buildDecisionOptions(input: {
  currency: string; baseBudgetMinor: number; evidenceStrong: boolean; uncertainty: 'LOW' | 'MEDIUM' | 'HIGH';
  guardrails: Guardrail[]; stopConditions: StopCondition[]; reversibility?: Reversibility;
}): DecisionOption[] {
  const rev = input.reversibility ?? 'EASILY_REVERSIBLE';
  const mk = (kind: OptionKind, pct: number, dir: DecisionOption['expectedDirection'], unc: 'LOW' | 'MEDIUM' | 'HIGH'): DecisionOption => {
    const impact = Math.round(input.baseBudgetMinor * (pct / 100));
    return {
      kind, currency: input.currency, budgetImpactMinor: impact, expectedDirection: dir,
      summary: { en: `${kind.replace('_', ' ').toLowerCase()}: review a ${pct > 0 ? '+' : ''}${pct}% budget change.`, ar: `${kind}: راجع تغييرًا في الميزانية بنسبة ${pct}%.` },
      risk: riskAdjust({ upside: { en: 'potential incremental volume', ar: 'حجم إضافي محتمل' }, downside: { en: 'potential efficiency loss / overspend', ar: 'خسارة كفاءة / إفراط محتمل' }, uncertainty: unc, reversibility: rev }),
      guardrails: input.guardrails, stopConditions: input.stopConditions, rollback: rollbackPlan({ kind: 'daily_budget_adjust', previousBudgetMinor: input.baseBudgetMinor, currency: input.currency }),
    };
  };
  const opts: DecisionOption[] = [mk('CONSERVATIVE', 10, 'POSITIVE_DIRECTION_EXPECTED', 'LOW'), mk('BALANCED', 20, input.evidenceStrong ? 'POSITIVE_DIRECTION_EXPECTED' : 'UNCERTAIN', input.uncertainty)];
  // Aggressive option only when evidence is strong AND the change is reversible enough.
  if (input.evidenceStrong && input.uncertainty !== 'HIGH' && rev !== 'DIFFICULT_TO_REVERSE') opts.push(mk('AGGRESSIVE_REVIEW', 40, 'UNCERTAIN', 'HIGH'));
  return opts;
}
