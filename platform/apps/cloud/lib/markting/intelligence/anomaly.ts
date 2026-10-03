/**
 * Phase 2H — anomaly intelligence beyond a single MAD rule. A point is flagged only when it is both
 * statistically extreme (robust modified z-score against a rolling baseline, with a mean/σ fallback
 * when MAD is 0) AND materially large in absolute + percentage terms. Day-of-week seasonality is
 * removed when enough history exists (≥ 2 full weeks), so a normal weekend dip is not an anomaly.
 * Classification is INFO/WATCH/ACTIONABLE/CRITICAL; only the genuinely abnormal and business-relevant
 * reaches CRITICAL, and alert storms are avoided by escalating only the most extreme point.
 */
import type { AnomalyClass } from './decision-model';

export interface AnomalyOptions {
  /** Modified z-score threshold for statistical extremeness. */
  z?: number;
  /** Minimum points before anomaly detection runs at all. */
  minPoints?: number;
  /** Minimum |pct| vs baseline to be material (filters tiny-base noise). */
  minPct?: number;
  /** Minimum absolute change vs baseline median (business materiality floor). */
  minAbsolute?: number;
  /** Remove day-of-week effect when the series is at least this many days. */
  seasonalMinDays?: number;
}

export interface AnomalyPoint {
  index: number;
  value: number;
  /** Baseline the point was judged against (seasonally adjusted when applicable). */
  baseline: number;
  z: number;
  pct?: number;
  classification: AnomalyClass;
}

export interface AnomalyReport {
  points: AnomalyPoint[];
  /** The single most extreme flagged point, if any (what a notification would carry). */
  top?: AnomalyPoint;
  seasonallyAdjusted: boolean;
  reasons: string[];
  actionable: boolean;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** `series` oldest→newest, daily cadence assumed for seasonality. */
export function detectAnomalies(series: number[], opts: AnomalyOptions = {}): AnomalyReport {
  const z0 = opts.z ?? 3.5;
  const minPoints = opts.minPoints ?? 7;
  const minPct = opts.minPct ?? 25;
  const minAbsolute = opts.minAbsolute ?? 0;
  const seasonalMinDays = opts.seasonalMinDays ?? 14;

  if (series.length < minPoints) {
    return { points: [], seasonallyAdjusted: false, reasons: [`need ${minPoints} points, got ${series.length}`], actionable: false };
  }

  // Seasonal (day-of-week) adjustment: divide each point by its weekday's median multiplier.
  let adjusted = series;
  let seasonallyAdjusted = false;
  if (series.length >= seasonalMinDays) {
    const overall = median(series) || 1;
    const byDow: number[][] = Array.from({ length: 7 }, () => []);
    series.forEach((v, i) => byDow[i % 7]!.push(v));
    // Clamp the seasonal multiplier to a sane band so a low-but-nonzero weekday median cannot
    // manufacture a huge divisor (and a false anomaly) on low-volume weekdays.
    const clamp = (x: number) => Math.min(4, Math.max(0.25, x));
    const dowFactor = byDow.map((vals) => (vals.length ? clamp((median(vals) || overall) / overall) : 1));
    adjusted = series.map((v, i) => (dowFactor[i % 7] ? v / dowFactor[i % 7]! : v));
    seasonallyAdjusted = true;
  }

  const med = median(adjusted);
  const mad = median(adjusted.map((v) => Math.abs(v - med)));
  let score: (v: number) => number;
  if (mad > 0) score = (v) => (0.6745 * (v - med)) / mad;
  else {
    const mean = adjusted.reduce((a, b) => a + b, 0) / adjusted.length;
    const sd = Math.sqrt(adjusted.reduce((a, b) => a + (b - mean) ** 2, 0) / adjusted.length);
    score = (v) => (sd === 0 ? 0 : (v - mean) / sd);
  }

  const points: AnomalyPoint[] = adjusted.map((v, index) => {
    const z = score(v);
    const pct = med !== 0 ? ((v - med) / Math.abs(med)) * 100 : undefined;
    const statExtreme = Math.abs(z) >= z0;
    const materialPct = pct == null ? false : Math.abs(pct) >= minPct;
    const materialAbs = Math.abs(series[index]! - med) >= minAbsolute;
    let classification: AnomalyClass = 'INFO';
    if (statExtreme && materialPct && materialAbs) {
      classification = Math.abs(z) >= z0 * 1.7 ? 'CRITICAL' : 'ACTIONABLE';
    } else if (statExtreme || (materialPct && Math.abs(z) >= z0 * 0.7)) {
      classification = 'WATCH';
    }
    return { index, value: round(series[index]!), baseline: round(med), z: round(z), pct: pct == null ? undefined : round(pct), classification };
  });

  // Avoid alert storms: escalate only the single most extreme flagged point to its class; others
  // of the same batch are capped at WATCH so one incident is not reported as many alerts.
  const flagged = points.filter((p) => p.classification === 'ACTIONABLE' || p.classification === 'CRITICAL').sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const top = flagged[0];
  if (top) {
    for (const p of flagged) if (p !== top && p.classification !== 'CRITICAL') p.classification = 'WATCH';
  }
  return {
    points, top,
    seasonallyAdjusted,
    reasons: top ? [`most extreme point z=${top.z}, ${top.pct}% vs baseline`] : ['no point is both statistically extreme and materially large'],
    actionable: !!top,
  };
}
function round(n: number): number { return Math.round(n * 100) / 100; }
