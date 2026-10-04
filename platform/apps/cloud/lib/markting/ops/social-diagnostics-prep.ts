/**
 * PHASE C.6 (item 10) — SOCIAL CREATIVE-HEALTH / FATIGUE DIAGNOSTICS (credential-free).
 *
 * PURE, read-only creative-fatigue diagnostics over canonical social metrics across two windows (a
 * current window vs a prior baseline). The core discipline: FATIGUE is a MULTI-SIGNAL verdict. A single
 * moving metric is never enough — one independent signal yields at most a WATCH, and a FATIGUE finding
 * REQUIRES >= 2 independent signals agreeing (e.g. frequency rising AND ctr declining, or cpm rising on
 * top). This refuses the classic false positive of calling fatigue off a lone noisy metric.
 *
 * No network, no provider call, no LLM. Everything is computed from metrics the caller already holds.
 */
import type { CanonicalMetric } from '../intelligence/model';

/** Metrics for one creative/entity over one window (canonical vocabulary). */
export interface CreativeWindow {
  /** The canonical entity (ad / creative) the window describes. */
  entityId: string;
  entityName?: string;
  metrics: Partial<Record<CanonicalMetric, number>>;
}

/** The independent fatigue signals we test. Each is derived from a DIFFERENT metric movement. */
export type FatigueSignalKind = 'FREQUENCY_RISING' | 'CTR_DECLINING' | 'CPM_RISING';

export interface FatigueSignal {
  kind: FatigueSignalKind;
  /** Prior-window value. */
  from: number;
  /** Current-window value. */
  to: number;
  /** Signed relative change (current/prior - 1); negative for declines. */
  relativeChange: number;
}

/** The verdict. FATIGUE requires >= 2 signals; a single signal is WATCH; none is HEALTHY. */
export type CreativeHealthStatus = 'HEALTHY' | 'WATCH' | 'FATIGUE';

export interface CreativeHealthFinding {
  entityId: string;
  status: CreativeHealthStatus;
  /** The independent signals that fired (0, 1, or >=2). */
  signals: FatigueSignal[];
  finding: string;
  /** Advisory only — this module surfaces, it never applies a change. */
  recommendedAction: string;
  reviewOnly: true;
}

/** The minimum number of INDEPENDENT signals required before a FATIGUE verdict may be emitted. */
export const MIN_SIGNALS_FOR_FATIGUE = 2 as const;

/** Relative-change thresholds for each signal (conservative; a movement must be meaningful). */
export interface FatigueThresholds {
  /** Frequency must rise by at least this fraction to count. */
  frequencyRisePct: number;
  /** CTR must fall by at least this fraction (magnitude) to count. */
  ctrDeclinePct: number;
  /** CPM must rise by at least this fraction to count. */
  cpmRisePct: number;
}

export const DEFAULT_FATIGUE_THRESHOLDS: FatigueThresholds = {
  frequencyRisePct: 0.15,
  ctrDeclinePct: 0.15,
  cpmRisePct: 0.15,
};

function relChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return to / from - 1;
}

/**
 * Detect the independent fatigue signals between a prior and current window. Each signal rests on a
 * DIFFERENT metric so that two firing signals are genuinely independent evidence, not one metric
 * double-counted. Pure.
 */
export function detectFatigueSignals(
  prior: CreativeWindow,
  current: CreativeWindow,
  thresholds: FatigueThresholds = DEFAULT_FATIGUE_THRESHOLDS,
): FatigueSignal[] {
  const signals: FatigueSignal[] = [];

  const freqFrom = prior.metrics.frequency;
  const freqTo = current.metrics.frequency;
  if (freqFrom != null && freqTo != null) {
    const rc = relChange(freqFrom, freqTo);
    if (rc != null && rc >= thresholds.frequencyRisePct) {
      signals.push({ kind: 'FREQUENCY_RISING', from: freqFrom, to: freqTo, relativeChange: rc });
    }
  }

  const ctrFrom = prior.metrics.ctr;
  const ctrTo = current.metrics.ctr;
  if (ctrFrom != null && ctrTo != null) {
    const rc = relChange(ctrFrom, ctrTo);
    if (rc != null && rc <= -thresholds.ctrDeclinePct) {
      signals.push({ kind: 'CTR_DECLINING', from: ctrFrom, to: ctrTo, relativeChange: rc });
    }
  }

  const cpmFrom = prior.metrics.cpm;
  const cpmTo = current.metrics.cpm;
  if (cpmFrom != null && cpmTo != null) {
    const rc = relChange(cpmFrom, cpmTo);
    if (rc != null && rc >= thresholds.cpmRisePct) {
      signals.push({ kind: 'CPM_RISING', from: cpmFrom, to: cpmTo, relativeChange: rc });
    }
  }

  return signals;
}

/**
 * Classify creative health from the detected signals. FATIGUE only when >= MIN_SIGNALS_FOR_FATIGUE
 * independent signals agree; exactly one signal is WATCH (never FATIGUE); none is HEALTHY. Pure.
 */
export function classifyCreativeHealth(
  prior: CreativeWindow,
  current: CreativeWindow,
  thresholds: FatigueThresholds = DEFAULT_FATIGUE_THRESHOLDS,
): CreativeHealthFinding {
  const signals = detectFatigueSignals(prior, current, thresholds);
  const status: CreativeHealthStatus =
    signals.length >= MIN_SIGNALS_FOR_FATIGUE ? 'FATIGUE' : signals.length === 1 ? 'WATCH' : 'HEALTHY';

  const names = signals.map((s) => s.kind).join(', ');
  const finding =
    status === 'FATIGUE'
      ? `Creative fatigue: ${signals.length} independent signals agree (${names})`
      : status === 'WATCH'
        ? `Single early signal (${names}) — monitor; not yet fatigue`
        : 'No fatigue signals detected';
  const recommendedAction =
    status === 'FATIGUE'
      ? 'Review for creative refresh (human decision — not applied).'
      : status === 'WATCH'
        ? 'Keep monitoring; one signal alone is not fatigue.'
        : 'No action.';

  return { entityId: current.entityId, status, signals, finding, recommendedAction, reviewOnly: true };
}

/** Classify a batch of prior/current window pairs. Pure. */
export function classifyCreativeHealthBatch(
  pairs: Array<{ prior: CreativeWindow; current: CreativeWindow }>,
  thresholds: FatigueThresholds = DEFAULT_FATIGUE_THRESHOLDS,
): CreativeHealthFinding[] {
  return pairs.map((p) => classifyCreativeHealth(p.prior, p.current, thresholds));
}
