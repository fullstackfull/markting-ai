/**
 * Phase 2I — trend engine. Distinguishes NOISE from a SHORT_TERM_MOVE, a PERSISTENT_TREND, and a
 * STRUCTURAL_SHIFT. One bad day never becomes a "trend": classification requires a configurable
 * minimum evidence window and directional consistency across the recent window, measured against a
 * robust baseline (median + MAD), not a single point.
 */
import type { BiText, TrendState } from './decision-model';

export interface TrendResult {
  state: TrendState;
  direction: 'up' | 'down' | 'flat';
  /** Fraction of recent points on the same side of the baseline (0..1). */
  consistency: number;
  recentMedian: number;
  baselineMedian: number;
  label: BiText;
  reasons: string[];
}

export interface TrendOptions {
  /** Minimum total points before any trend (not noise) can be asserted. */
  minPoints?: number;
  /** Size of the recent window compared against the earlier baseline. */
  recentWindow?: number;
  /** Robust spreads beyond baseline median to call a persistent move a structural shift. */
  structuralMads?: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** `series` is oldest→newest. */
export function classifyTrend(series: number[], opts: TrendOptions = {}): TrendResult {
  const minPoints = opts.minPoints ?? 7;
  const recentWindow = opts.recentWindow ?? 3;
  const structuralMads = opts.structuralMads ?? 5;
  const reasons: string[] = [];
  if (series.length < minPoints) {
    return { state: 'NOISE', direction: 'flat', consistency: 0, recentMedian: 0, baselineMedian: 0, label: LBL.NOISE, reasons: [`need ${minPoints} points, got ${series.length}`] };
  }
  const recent = series.slice(-recentWindow);
  const baseline = series.slice(0, Math.max(1, series.length - recentWindow));
  const baselineMedian = median(baseline);
  const recentMedian = median(recent);
  const mad = median(baseline.map((v) => Math.abs(v - baselineMedian))) || 0;
  const diff = recentMedian - baselineMedian;
  // A move is only directional when it clears BOTH the robust baseline spread (MAD) and a small
  // relative floor — so a ~1% wiggle around a stable level reads as noise, not a trend.
  const flatThreshold = Math.max(mad, Math.abs(baselineMedian) * 0.03, 1e-9);
  const direction: TrendResult['direction'] = Math.abs(diff) < flatThreshold ? 'flat' : diff > 0 ? 'up' : 'down';

  // Directional consistency across the recent window relative to the baseline.
  const side = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
  const consistent = side === 0 ? 0 : recent.filter((v) => Math.sign(v - baselineMedian) === side).length;
  const consistency = recent.length ? consistent / recent.length : 0;

  let state: TrendState;
  if (direction === 'flat') { state = 'NOISE'; reasons.push('recent level is within normal spread of the baseline'); }
  else if (consistency < 0.67) { state = 'SHORT_TERM_MOVE'; reasons.push('move is not yet directionally consistent across the recent window'); }
  else if (mad > 0 && Math.abs(diff) >= structuralMads * mad) { state = 'STRUCTURAL_SHIFT'; reasons.push(`recent level shifted ${Math.round(Math.abs(diff) / mad)}× the baseline spread and held`); }
  else { state = 'PERSISTENT_TREND'; reasons.push('consistent directional move across the recent window beyond baseline noise'); }

  return { state, direction, consistency: Math.round(consistency * 100) / 100, recentMedian: round(recentMedian), baselineMedian: round(baselineMedian), label: LBL[state], reasons };
}

const LBL: Record<TrendState, BiText> = {
  NOISE: { en: 'Noise', ar: 'تشويش' },
  SHORT_TERM_MOVE: { en: 'Short-term move', ar: 'تحرّك قصير المدى' },
  PERSISTENT_TREND: { en: 'Persistent trend', ar: 'اتجاه مستمر' },
  STRUCTURAL_SHIFT: { en: 'Structural shift', ar: 'تحوّل هيكلي' },
};
function round(n: number): number { return Math.round(n * 100) / 100; }
