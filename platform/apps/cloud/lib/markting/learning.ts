/**
 * Phase 3K/3L — learning SIGNALS and confidence calibration. These are deterministic aggregations over
 * the decision/outcome history that the AI may use as CONTEXT. They do NOT self-modify any policy rule,
 * confidence definition, or safety gate. No global "AI accuracy = 94%" is produced — effectiveness is
 * reported per dimension WITH sample size, and calibration reports INSUFFICIENT_HISTORY rather than a
 * misleading number when the sample is too small.
 */
import type { Confidence, Risk } from './intelligence/decision-model';
import type { OutcomeClass } from './outcomes';

export interface LedgerRow {
  recommendationId: string;
  category: string;
  provider?: string;
  confidence: Confidence;
  risk: Risk;
  accepted: boolean;
  rejected: boolean;
  executed: boolean;
  /** Measured outcome classification, when an outcome was measured. */
  outcomeClass?: OutcomeClass;
  rejectionReason?: string;
}

export interface DimensionStats {
  made: number;
  accepted: number;
  rejected: number;
  executed: number;
  outcomeMeasured: number;
  positiveAligned: number;
  negativeAligned: number;
  inconclusive: number;
  contaminated: number;
}

function emptyStats(): DimensionStats {
  return { made: 0, accepted: 0, rejected: 0, executed: 0, outcomeMeasured: 0, positiveAligned: 0, negativeAligned: 0, inconclusive: 0, contaminated: 0 };
}

function fold(stats: DimensionStats, r: LedgerRow): void {
  stats.made += 1;
  if (r.accepted) stats.accepted += 1;
  if (r.rejected) stats.rejected += 1;
  if (r.executed) stats.executed += 1;
  if (r.outcomeClass && r.outcomeClass !== 'OUTCOME_PENDING') {
    stats.outcomeMeasured += 1;
    if (r.outcomeClass === 'POSITIVE') stats.positiveAligned += 1;
    else if (r.outcomeClass === 'NEGATIVE') stats.negativeAligned += 1;
    else if (r.outcomeClass === 'CONTAMINATED') stats.contaminated += 1;
    else stats.inconclusive += 1; // NEUTRAL / INCONCLUSIVE / INSUFFICIENT_DATA
  }
}

export interface EffectivenessLedger {
  overall: DimensionStats;
  byCategory: Record<string, DimensionStats>;
  byProvider: Record<string, DimensionStats>;
  byConfidence: Record<Confidence, DimensionStats>;
  byRisk: Record<Risk, DimensionStats>;
  rejectionReasons: Record<string, number>;
  /** Deliberately NOT a single accuracy score — alignment is only meaningful per dimension + n. */
  note: string;
}

export function buildEffectivenessLedger(rows: LedgerRow[]): EffectivenessLedger {
  const ledger: EffectivenessLedger = {
    overall: emptyStats(), byCategory: {}, byProvider: {}, byConfidence: { LOW: emptyStats(), MEDIUM: emptyStats(), HIGH: emptyStats() },
    byRisk: { LOW: emptyStats(), MODERATE: emptyStats(), HIGH: emptyStats(), CRITICAL: emptyStats() }, rejectionReasons: {},
    note: 'Alignment counts are temporal alignment, not proven causation; read per dimension with its sample size. No global accuracy score is implied.',
  };
  for (const r of rows) {
    fold(ledger.overall, r);
    ledger.byCategory[r.category] ??= emptyStats();
    fold(ledger.byCategory[r.category]!, r);
    if (r.provider) {
      ledger.byProvider[r.provider] ??= emptyStats();
      fold(ledger.byProvider[r.provider]!, r);
    }
    fold(ledger.byConfidence[r.confidence], r);
    fold(ledger.byRisk[r.risk], r);
    if (r.rejectionReason) ledger.rejectionReasons[r.rejectionReason] = (ledger.rejectionReasons[r.rejectionReason] ?? 0) + 1;
  }
  return ledger;
}

export interface CalibrationReport {
  perLevel: Record<Confidence, { measured: number; positiveAligned: number; alignmentRate: number | null }>;
  /** True only when there is enough history AND HIGH aligns at least as well as MEDIUM and LOW. */
  wellCalibrated: boolean | null;
  verdict: 'WELL_CALIBRATED' | 'MISCALIBRATED' | 'INSUFFICIENT_HISTORY';
  minSamplePerLevel: number;
}

/**
 * Confidence calibration (3L): do HIGH-confidence recommendations actually align with outcomes more
 * than MEDIUM/LOW? Reports INSUFFICIENT_HISTORY rather than a number when any level is under-sampled.
 * It never changes confidence definitions to improve the headline.
 */
export function calibrateConfidence(rows: LedgerRow[], minSamplePerLevel = 10): CalibrationReport {
  const per = { LOW: { measured: 0, positiveAligned: 0 }, MEDIUM: { measured: 0, positiveAligned: 0 }, HIGH: { measured: 0, positiveAligned: 0 } };
  for (const r of rows) {
    if (!r.outcomeClass || r.outcomeClass === 'OUTCOME_PENDING' || r.outcomeClass === 'CONTAMINATED' || r.outcomeClass === 'INSUFFICIENT_DATA') continue;
    per[r.confidence].measured += 1;
    if (r.outcomeClass === 'POSITIVE') per[r.confidence].positiveAligned += 1;
  }
  const rate = (x: { measured: number; positiveAligned: number }) => (x.measured > 0 ? x.positiveAligned / x.measured : null);
  const perLevel = {
    LOW: { ...per.LOW, alignmentRate: rate(per.LOW) },
    MEDIUM: { ...per.MEDIUM, alignmentRate: rate(per.MEDIUM) },
    HIGH: { ...per.HIGH, alignmentRate: rate(per.HIGH) },
  };
  const enough = per.LOW.measured >= minSamplePerLevel && per.MEDIUM.measured >= minSamplePerLevel && per.HIGH.measured >= minSamplePerLevel;
  if (!enough) return { perLevel, wellCalibrated: null, verdict: 'INSUFFICIENT_HISTORY', minSamplePerLevel };
  const well = (perLevel.HIGH.alignmentRate ?? 0) >= (perLevel.MEDIUM.alignmentRate ?? 0) && (perLevel.MEDIUM.alignmentRate ?? 0) >= (perLevel.LOW.alignmentRate ?? 0);
  return { perLevel, wellCalibrated: well, verdict: well ? 'WELL_CALIBRATED' : 'MISCALIBRATED', minSamplePerLevel };
}
