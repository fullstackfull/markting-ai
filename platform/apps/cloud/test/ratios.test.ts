import { describe, expect, it } from 'vitest';
import { safeRatio, roas, ctrPct, cvrPct, cpa, refundRatePct, ratioText } from '@/lib/markting/orchestrator/ratios';

/**
 * Hardening Program 23 — ratio safety. Every display ratio degrades to an explicit UNKNOWN (with a
 * reason), never a silent 0 / Infinity / NaN, on an unusable denominator, missing input, mixed currency
 * or incompatible period. A real zero numerator stays a known 0.
 */
describe('safeRatio — the rule set', () => {
  it('computes a known quotient with scale + rounding', () => {
    expect(roas(900, 200, 'SAR')).toEqual({ state: 'KNOWN', value: 4.5 });
    expect(ctrPct(50, 1000)).toEqual({ state: 'KNOWN', value: 5 });
  });
  it('zero denominator → UNKNOWN(ZERO_DENOMINATOR), not Infinity', () => {
    expect(cpa(1000, 0, 'SAR')).toEqual({ state: 'UNKNOWN', reason: 'ZERO_DENOMINATOR' });
    expect(roas(500, 0)).toEqual({ state: 'UNKNOWN', reason: 'ZERO_DENOMINATOR' });
  });
  it('missing / non-finite input → UNKNOWN(MISSING_INPUT), not NaN', () => {
    expect(ctrPct(undefined, 1000)).toEqual({ state: 'UNKNOWN', reason: 'MISSING_INPUT' });
    expect(cvrPct(10, null)).toEqual({ state: 'UNKNOWN', reason: 'MISSING_INPUT' });
    expect(safeRatio(Number.NaN, 5)).toEqual({ state: 'UNKNOWN', reason: 'MISSING_INPUT' });
  });
  it('different currencies → UNKNOWN(MIXED_CURRENCY)', () => {
    expect(roas(900, 200, undefined)).toEqual({ state: 'KNOWN', value: 4.5 }); // no currency asserted → fine
    expect(safeRatio(900, 200, { numeratorCurrency: 'USD', denominatorCurrency: 'SAR' })).toEqual({ state: 'UNKNOWN', reason: 'MIXED_CURRENCY' });
  });
  it('incompatible periods → UNKNOWN(INCOMPATIBLE_PERIOD)', () => {
    expect(safeRatio(100, 50, { numeratorPeriod: '2026-09', denominatorPeriod: '2026-08' })).toEqual({ state: 'UNKNOWN', reason: 'INCOMPATIBLE_PERIOD' });
  });
  it('a real zero numerator is a KNOWN zero, never clamped to UNKNOWN', () => {
    expect(cvrPct(0, 1000)).toEqual({ state: 'KNOWN', value: 0 });
    expect(refundRatePct(0, 5000, 'SAR')).toEqual({ state: 'KNOWN', value: 0 });
  });
  it('reports the most specific reason first (currency before zero denominator)', () => {
    expect(safeRatio(900, 0, { numeratorCurrency: 'USD', denominatorCurrency: 'SAR' })).toEqual({ state: 'UNKNOWN', reason: 'MIXED_CURRENCY' });
  });
  it('ratioText renders UNKNOWN with the supplied label', () => {
    expect(ratioText(roas(900, 200))).toBe('4.5');
    expect(ratioText(cpa(1, 0), 'غير معروف')).toBe('غير معروف');
  });
});
