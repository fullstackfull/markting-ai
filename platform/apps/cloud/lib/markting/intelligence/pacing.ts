/**
 * Phase 2E — budget pacing intelligence. Deterministic, currency-safe, timezone-aware. It separates a
 * DELIVERY problem (cannot spend the budget) from a BUDGET OPPORTUNITY (could use more budget), and it
 * never recommends scaling merely because a campaign is underpacing — underpacing is a signal to review
 * delivery, not an instruction to raise budget. Projections are straight-line and clearly labelled as
 * such (a transparent method, Phase 2J-aligned), never presented as certainty.
 */
import type { BiText } from './decision-model';

export type PacingStatus = 'ON_TRACK' | 'OVERPACING' | 'UNDERPACING' | 'NOT_EVALUABLE';
export type PacingKind = 'daily' | 'monthly' | 'period';

export interface PacingInput {
  /** Spend so far in the current period (same currency as the budget). */
  spendToDate: number;
  /** Planned budget for the whole period. */
  plannedBudget: number;
  currency?: string;
  /** Elapsed vs total time in the period (days; fractional for a partial day). */
  daysElapsed: number;
  daysInPeriod: number;
  kind: PacingKind;
  /** True when the current day is still open (totals are partial). */
  partialDay?: boolean;
  /** Mixed-currency spend cannot be paced. */
  mixedCurrency?: boolean;
}

export interface PacingResult {
  status: PacingStatus;
  expectedFraction: number;
  actualFraction: number;
  /** Straight-line projected total spend for the period (transparent method). */
  projectedSpend: number;
  projectedOverUnderPct?: number;
  /** DELIVERY vs OPPORTUNITY disambiguation for an underpacing account. */
  interpretation: 'DELIVERY_OR_OPPORTUNITY_REVIEW' | 'PACING_HEALTHY' | 'SPEND_AHEAD_REVIEW' | 'NOT_EVALUABLE';
  currency?: string;
  label: BiText;
  reasons: string[];
  method: 'straight_line';
}

export function analyzePacing(input: PacingInput): PacingResult {
  const reasons: string[] = [];
  if (input.plannedBudget <= 0) reasons.push('no planned budget configured');
  if (input.daysInPeriod <= 0) reasons.push('period length unknown');
  if (input.mixedCurrency) reasons.push('spend spans multiple currencies');
  if (reasons.length) {
    return { status: 'NOT_EVALUABLE', expectedFraction: 0, actualFraction: 0, projectedSpend: 0, interpretation: 'NOT_EVALUABLE', currency: input.currency, label: { en: 'Pacing not evaluable', ar: 'تعذّر تقييم وتيرة الإنفاق' }, reasons, method: 'straight_line' };
  }
  const expectedFraction = Math.min(1, input.daysElapsed / input.daysInPeriod);
  const actualFraction = input.spendToDate / input.plannedBudget;
  const drift = actualFraction - expectedFraction;
  const elapsed = Math.max(1e-9, Math.min(1, input.daysElapsed / input.daysInPeriod));
  const projectedSpend = input.spendToDate / elapsed; // straight-line extrapolation to period end
  const projectedOverUnderPct = ((projectedSpend - input.plannedBudget) / input.plannedBudget) * 100;

  let status: PacingStatus;
  let interpretation: PacingResult['interpretation'];
  let label: BiText;
  if (Math.abs(drift) < 0.1) {
    status = 'ON_TRACK'; interpretation = 'PACING_HEALTHY';
    label = { en: 'On track', ar: 'ضمن المسار' };
  } else if (drift > 0) {
    status = 'OVERPACING'; interpretation = 'SPEND_AHEAD_REVIEW';
    label = { en: 'Overpacing — spending ahead of plan', ar: 'إنفاق أسرع من الخطة' };
  } else {
    status = 'UNDERPACING';
    // Underpacing is NOT a scale signal. It is a prompt to check whether delivery is constrained
    // (an auction/targeting/creative problem) or whether there is genuine room to deploy more budget.
    interpretation = 'DELIVERY_OR_OPPORTUNITY_REVIEW';
    label = { en: 'Underpacing — review delivery vs budget opportunity', ar: 'إنفاق أبطأ من الخطة — راجع التسليم مقابل فرصة الميزانية' };
  }
  if (input.partialDay) reasons.push('current day is still open; actuals are partial');
  return { status, expectedFraction, actualFraction, projectedSpend, projectedOverUnderPct, interpretation, currency: input.currency, label, reasons, method: 'straight_line' };
}
