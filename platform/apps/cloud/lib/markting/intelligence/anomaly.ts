/**
 * Phase 2H — anomaly intelligence beyond a single MAD rule. A point is flagged only when it is both
 * statistically extreme (robust modified z-score) AND materially large in absolute + percentage terms.
 *
 * BASELINE (reassessment data-science P1 #2): each point is scored against a baseline that EXCLUDES the
 * point itself — a trailing window of the preceding points when enough history exists, otherwise a
 * leave-one-out baseline over the rest of the series. This removes the self-contamination and spike-
 * masking of the previous global in-sample baseline (which included the very point being judged), and
 * is what makes the docstring's "rolling baseline" actually true.
 *
 * SEASONALITY (reassessment data-science P1 #3): day-of-week adjustment is applied ONLY when the caller
 * supplies anchored `weekdays` (0–6 per point). The previous `index % 7` scheme silently assumed index
 * 0 was a fixed weekday and the series was gap-free daily, which manufactured anomalies on any gap or
 * phase offset. With no anchored weekdays, no seasonal adjustment is applied (honest, not faked).
 *
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
  /** Remove day-of-week effect when the series is at least this many days AND weekdays are supplied. */
  seasonalMinDays?: number;
  /** Trailing baseline window length (points). Each point is judged against up to this many priors. */
  baselineWindow?: number;
  /** Minimum priors needed to use the trailing window; below this, leave-one-out over the rest. */
  minBaselinePoints?: number;
  /**
   * Anchored day-of-week per point (0–6), oldest→newest, same length as `series`. REQUIRED for any
   * seasonal adjustment; without it seasonality is not inferred from the index.
   */
  weekdays?: number[];
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

/** Robust center (median) + modified z-score function for a baseline sample, with a mean/σ fallback. */
function baselineScorer(baseline: number[]): { center: number; score: (v: number) => number } {
  const center = median(baseline);
  const mad = median(baseline.map((v) => Math.abs(v - center)));
  if (mad > 0) return { center, score: (v) => (0.6745 * (v - center)) / mad };
  const mean = baseline.reduce((a, b) => a + b, 0) / (baseline.length || 1);
  const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / (baseline.length || 1));
  return { center, score: (v) => (sd === 0 ? 0 : (v - mean) / sd) };
}

/** `series` oldest→newest. Seasonality requires anchored `opts.weekdays`; otherwise it is not applied. */
export function detectAnomalies(series: number[], opts: AnomalyOptions = {}): AnomalyReport {
  const z0 = opts.z ?? 3.5;
  const minPoints = opts.minPoints ?? 7;
  const minPct = opts.minPct ?? 25;
  const minAbsolute = opts.minAbsolute ?? 0;
  const seasonalMinDays = opts.seasonalMinDays ?? 14;
  const baselineWindow = opts.baselineWindow ?? 28;
  const minBaselinePoints = opts.minBaselinePoints ?? 5;

  if (series.length < minPoints) {
    return { points: [], seasonallyAdjusted: false, reasons: [`need ${minPoints} points, got ${series.length}`], actionable: false };
  }

  // Seasonal (day-of-week) adjustment — ONLY with anchored weekdays (never inferred from the index).
  let adjusted = series;
  let seasonallyAdjusted = false;
  const weekdays = opts.weekdays;
  if (weekdays && weekdays.length === series.length && series.length >= seasonalMinDays) {
    const overall = median(series) || 1;
    const byDow: number[][] = Array.from({ length: 7 }, () => []);
    series.forEach((v, i) => { const d = weekdays[i]!; if (d >= 0 && d <= 6) byDow[d]!.push(v); });
    // Clamp the seasonal multiplier so a low-but-nonzero weekday median cannot manufacture a huge divisor.
    const clamp = (x: number) => Math.min(4, Math.max(0.25, x));
    const dowFactor = byDow.map((vals) => (vals.length ? clamp((median(vals) || overall) / overall) : 1));
    adjusted = series.map((v, i) => { const f = dowFactor[weekdays[i]!]; return f ? v / f : v; });
    seasonallyAdjusted = true;
  }

  const points: AnomalyPoint[] = adjusted.map((v, index) => {
    // Baseline EXCLUDES the point: a trailing window of priors when long enough, else leave-one-out.
    const trailing = adjusted.slice(Math.max(0, index - baselineWindow), index);
    const baseline = trailing.length >= minBaselinePoints
      ? trailing
      : adjusted.filter((_, j) => j !== index);
    const { center, score } = baselineScorer(baseline);
    const z = score(v);
    const pct = center !== 0 ? ((v - center) / Math.abs(center)) * 100 : undefined;
    const statExtreme = Math.abs(z) >= z0;
    const materialPct = pct == null ? false : Math.abs(pct) >= minPct;
    const materialAbs = Math.abs(series[index]! - center) >= minAbsolute;
    let classification: AnomalyClass = 'INFO';
    if (statExtreme && materialPct && materialAbs) {
      classification = Math.abs(z) >= z0 * 1.7 ? 'CRITICAL' : 'ACTIONABLE';
    } else if (statExtreme || (materialPct && Math.abs(z) >= z0 * 0.7)) {
      classification = 'WATCH';
    }
    return { index, value: round(series[index]!), baseline: round(center), z: round(z), pct: pct == null ? undefined : round(pct), classification };
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
