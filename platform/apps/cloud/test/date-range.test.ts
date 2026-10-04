import { describe, expect, it } from 'vitest';
import { resolveRange, parseRangeParam } from '@/lib/cloud/date-range';

/** PHASE A (A6): deterministic, timezone-aware range + comparison-period resolution. */
const NOW = new Date('2026-10-04T12:00:00.000Z');

describe('resolveRange', () => {
  it('last_7_days → 7 inclusive days ending today, previous = preceding 7 days', () => {
    const r = resolveRange('last_7_days', 'UTC', NOW);
    expect(r.current).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(r.days).toBe(7);
    expect(r.previous).toEqual({ start: '2026-09-21', end: '2026-09-27' });
  });
  it('yesterday → single preceding day', () => {
    expect(resolveRange('yesterday', 'UTC', NOW).current).toEqual({ start: '2026-10-03', end: '2026-10-03' });
  });
  it('last_30_days → 30 inclusive days', () => {
    const r = resolveRange('last_30_days', 'UTC', NOW);
    expect(r.current).toEqual({ start: '2026-09-05', end: '2026-10-04' });
    expect(r.days).toBe(30);
  });
  it('custom window resolves verbatim with an equal-length previous window', () => {
    const r = resolveRange({ start: '2026-01-01', end: '2026-01-10' }, 'UTC', NOW);
    expect(r.current).toEqual({ start: '2026-01-01', end: '2026-01-10' });
    expect(r.days).toBe(10);
    expect(r.previous).toEqual({ start: '2025-12-22', end: '2025-12-31' });
  });
  it('flags a UTC fallback when no account timezone is known, and does not when one is', () => {
    expect(resolveRange('today', undefined, NOW).timezoneFallback).toBe(true);
    expect(resolveRange('today', 'Asia/Riyadh', NOW).timezoneFallback).toBe(false);
  });
  it('respects the account timezone for the day boundary (Riyadh is UTC+3)', () => {
    // 2026-10-04T23:00Z is already 2026-10-05 in Riyadh.
    const late = new Date('2026-10-04T23:00:00.000Z');
    expect(resolveRange('today', 'Asia/Riyadh', late).current.end).toBe('2026-10-05');
    expect(resolveRange('today', 'UTC', late).current.end).toBe('2026-10-04');
  });
  it('rejects an inverted custom range', () => {
    expect(() => resolveRange({ start: '2026-02-01', end: '2026-01-01' }, 'UTC', NOW)).toThrow();
  });
  it('marks a window ending today as INCOMPLETE and a closed window as complete', () => {
    expect(resolveRange('last_7_days', 'UTC', NOW).windowComplete).toBe(false); // ends today → partial
    expect(resolveRange('today', 'UTC', NOW).windowComplete).toBe(false);
    expect(resolveRange('yesterday', 'UTC', NOW).windowComplete).toBe(true);
    expect(resolveRange({ start: '2026-01-01', end: '2026-01-10' }, 'UTC', NOW).windowComplete).toBe(true);
    expect(resolveRange({ start: '2026-09-28', end: '2026-10-04' }, 'UTC', NOW).windowComplete).toBe(false); // ends today
  });
});

describe('parseRangeParam', () => {
  it('defaults to last_30_days', () => {
    expect(parseRangeParam(undefined)).toBe('last_30_days');
    expect(parseRangeParam('nonsense')).toBe('last_30_days');
  });
  it('parses presets and custom windows', () => {
    expect(parseRangeParam('last_7_days')).toBe('last_7_days');
    expect(parseRangeParam('2026-01-01..2026-01-31')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });
});
