/**
 * Phase 2E — budget pacing intelligence. Deterministic and currency-safe. It separates a DELIVERY
 * problem (cannot spend the budget) from a BUDGET OPPORTUNITY (could use more budget), and it never
 * recommends scaling merely because a campaign is underpacing — underpacing is a signal to review
 * delivery, not an instruction to raise budget. Projections are straight-line and clearly labelled as
 * such (a transparent method, Phase 2J-aligned), never presented as certainty.
 *
 * TIMEZONE: this module is NOT itself timezone-aware. `daysElapsed`/`daysInPeriod`/`partialDay` are
 * computed by the caller in the account's reporting timezone and passed in; the correctness of the
 * day math is the caller's responsibility (reassessment data-science P2 #9).
 *
 * EARLY-PERIOD GUARD: a straight-line projection is unstable when very little of the period has
 * elapsed (spendToDate / tiny-fraction explodes). Below MIN_ELAPSED_FRACTION_FOR_PROJECTION of the
 * period (or less than one full day elapsed) no projection is emitted — projectedOverUnderPct is
 * omitted and projectedSpend is reported as a floor (= spend to date) with an explicit reason.
 */
import type { BiText } from './decision-model';

/** Below this elapsed fraction of the period, a straight-line projection is too unstable to surface. */
export const MIN_ELAPSED_FRACTION_FOR_PROJECTION = 0.1;

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
  // Early-period guard: a straight-line projection divides spend-to-date by the elapsed fraction, which
  // explodes when the fraction is tiny. Only project once enough of the period (and ≥1 day) has elapsed.
  const projectable = elapsed >= MIN_ELAPSED_FRACTION_FOR_PROJECTION && input.daysElapsed >= 1;
  const projectedSpend = projectable ? input.spendToDate / elapsed : input.spendToDate; // floor when not projectable
  const projectedOverUnderPct = projectable ? ((projectedSpend - input.plannedBudget) / input.plannedBudget) * 100 : undefined;

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
  if (!projectable) reasons.push(`too early in the period to project reliably (< ${Math.round(MIN_ELAPSED_FRACTION_FOR_PROJECTION * 100)}% elapsed or < 1 day); projection withheld`);
  return { status, expectedFraction, actualFraction, projectedSpend, projectedOverUnderPct, interpretation, currency: input.currency, label, reasons, method: 'straight_line' };
}
