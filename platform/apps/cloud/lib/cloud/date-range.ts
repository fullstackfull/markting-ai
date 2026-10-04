/**
 * PHASE A (A6) — canonical date-range + comparison-period resolution.
 *
 * Pure + deterministic (no DB, no server-only) so it is unit-testable and shared by the UI range control,
 * the live gatherer, and the report reads. Day boundaries are computed in the ACCOUNT/ORG timezone when
 * one is known; when it is NOT known we fall back to UTC and FLAG it (timezoneFallback) so a surface can
 * state the fallback explicitly rather than silently pretending a business day == a UTC day.
 */
export const RANGE_PRESETS = ['today', 'yesterday', 'last_7_days', 'last_14_days', 'last_30_days'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
/** A preset, or an explicit inclusive custom window (YYYY-MM-DD). */
export type RangeSelection = RangePreset | { start: string; end: string };

export interface ResolvedRange {
  preset?: RangePreset;
  /** The window under analysis, inclusive YYYY-MM-DD. */
  current: { start: string; end: string };
  /** The equal-length immediately-preceding window, for period-over-period comparison. */
  previous: { start: string; end: string };
  /** Inclusive day count of the current window. */
  days: number;
  /** IANA timezone the boundaries were computed in. */
  timezone: string;
  /** True when no account/org timezone was known and we fell back to UTC (surface must disclose this). */
  timezoneFallback: boolean;
  /** Civil "today" in the resolved timezone (YYYY-MM-DD). */
  today: string;
  /** True only when the window is closed (ends before today) — a window ending today is partial. */
  windowComplete: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isRangePreset(v: string): v is RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(v);
}

/** Civil "today" (YYYY-MM-DD) in a timezone. Falls back to UTC date parts if the tz is invalid. */
function civilToday(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch { /* invalid tz → UTC */ }
  return now.toISOString().slice(0, 10);
}

/** Add n days to a YYYY-MM-DD civil date (UTC-based arithmetic on the civil date — safe for day counting). */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayCount(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00.000Z`);
  const b = Date.parse(`${end}T00:00:00.000Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * Resolve a selection into current + previous windows in the given timezone (or UTC fallback).
 * `timezoneInput` should be the account/org IANA timezone when known, else undefined.
 */
export function resolveRange(selection: RangeSelection, timezoneInput?: string | null, now: Date = new Date()): ResolvedRange {
  const timezoneFallback = !timezoneInput;
  const timezone = timezoneInput || 'UTC';
  const today = civilToday(timezone, now);

  let current: { start: string; end: string };
  let preset: RangePreset | undefined;
  if (typeof selection === 'object') {
    if (!ISO_DATE.test(selection.start) || !ISO_DATE.test(selection.end) || selection.start > selection.end) {
      throw new Error(`Invalid custom range ${selection.start}..${selection.end}`);
    }
    current = { start: selection.start, end: selection.end };
  } else {
    preset = selection;
    switch (selection) {
      case 'today': current = { start: today, end: today }; break;
      case 'yesterday': { const y = addDays(today, -1); current = { start: y, end: y }; break; }
      case 'last_7_days': current = { start: addDays(today, -6), end: today }; break;
      case 'last_14_days': current = { start: addDays(today, -13), end: today }; break;
      case 'last_30_days': current = { start: addDays(today, -29), end: today }; break;
    }
  }

  const days = dayCount(current.start, current.end);
  const previous = { start: addDays(current.start, -days), end: addDays(current.start, -1) };
  // A window is complete only when it closes before today; a window ending today (or in the future) is a
  // partial day and must not be treated as a closed window by the evidence gate.
  const windowComplete = current.end < today;
  return { preset, current, previous, days, timezone, timezoneFallback, today, windowComplete };
}

/** Parse a `range` search-param value into a RangeSelection, defaulting to last_30_days. */
export function parseRangeParam(raw: string | undefined | null): RangeSelection {
  if (!raw) return 'last_30_days';
  if (isRangePreset(raw)) return raw;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (m) return { start: m[1]!, end: m[2]! };
  return 'last_30_days';
}
