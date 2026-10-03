/**
 * Phase 3W — outcome dashboard selectors. Builds useful, HONEST metrics (never a misleading single
 * score): recommendations reviewed/accepted/executed, outcomes measured, positive/negative-aligned,
 * inconclusive — broken down by provider/category/confidence/time — and ALWAYS carrying sample size.
 * Pure aggregation over the effectiveness ledger (which the store produces).
 */
import type { EffectivenessLedger, DimensionStats } from './learning';

export interface DashboardCell { label: string; made: number; accepted: number; executed: number; outcomeMeasured: number; positiveAligned: number; negativeAligned: number; inconclusive: number; contaminated: number; sampleSize: number }

function toCell(label: string, s: DimensionStats): DashboardCell {
  return { label, made: s.made, accepted: s.accepted, executed: s.executed, outcomeMeasured: s.outcomeMeasured, positiveAligned: s.positiveAligned, negativeAligned: s.negativeAligned, inconclusive: s.inconclusive, contaminated: s.contaminated, sampleSize: s.outcomeMeasured };
}

export interface OutcomeDashboard {
  overall: DashboardCell;
  byProvider: DashboardCell[];
  byCategory: DashboardCell[];
  byConfidence: DashboardCell[];
  byRisk: DashboardCell[];
  /** Explicit reminder rendered with the dashboard. */
  caveat: string;
}

export function buildOutcomeDashboard(ledger: EffectivenessLedger): OutcomeDashboard {
  return {
    overall: toCell('overall', ledger.overall),
    byProvider: Object.entries(ledger.byProvider).map(([k, s]) => toCell(k, s)),
    byCategory: Object.entries(ledger.byCategory).map(([k, s]) => toCell(k, s)),
    byConfidence: Object.entries(ledger.byConfidence).map(([k, s]) => toCell(k, s)),
    byRisk: Object.entries(ledger.byRisk).map(([k, s]) => toCell(k, s)),
    caveat: 'Positive/negative are TEMPORAL ALIGNMENT with the recommendation, not proven causation. Read every cell with its sample size; small samples are not reliable.',
  };
}
