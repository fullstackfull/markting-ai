import { describe, expect, it } from 'vitest';
import {
  currencyExponent,
  isKnownCurrency,
  microsToMinorUnits,
  minorUnitsToMicros,
  moneyFromMicros,
  moneyFromMinor,
  moneyToMicros,
} from '../src/money.js';

describe('canonical money: currency-aware unit conversion (R0-04)', () => {
  it('knows the required currency matrix exponents', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('GBP')).toBe(2);
    expect(currencyExponent('SAR')).toBe(2);
    expect(currencyExponent('AED')).toBe(2);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('usd')).toBe(2); // case-insensitive
  });

  it('fails closed on an unknown currency instead of assuming 2 decimals', () => {
    expect(isKnownCurrency('ZZZ')).toBe(false);
    expect(() => currencyExponent('ZZZ')).toThrow(/Unknown currency/);
    expect(() => minorUnitsToMicros(100, 'ZZZ')).toThrow(/Unknown currency/);
    expect(() => microsToMinorUnits(1_000_000, 'ZZZ')).toThrow(/Unknown currency/);
  });

  it('100 JPY (0-decimal) is 100 whole yen = 100_000_000 micros, never 10_000 micros or 100× inflation', () => {
    // A fixed 2-decimal assumption (×10_000) would make 100 "minor units" only 1_000_000 micros
    // (1 unit) — understating — and the inverse (micros→cents ÷10_000) would 100× a yen budget.
    expect(minorUnitsToMicros(100, 'JPY')).toBe(100_000_000);
    // 100 whole yen round-trips to 100 native minor units, NOT 10_000.
    expect(microsToMinorUnits(100_000_000, 'JPY')).toBe(100);
    expect(microsToMinorUnits(100_000_000, 'JPY')).not.toBe(10_000);
  });

  it('1 KWD (3-decimal) = 1000 fils = 1_000_000 micros, not treated like 1 USD cent', () => {
    expect(minorUnitsToMicros(1000, 'KWD')).toBe(1_000_000); // 1 KWD
    expect(minorUnitsToMicros(1, 'KWD')).toBe(1000); // 1 fils = 0.001 KWD
    // 1 USD cent is 10_000 micros; 1 KWD fils is 1000 micros — different semantics.
    expect(minorUnitsToMicros(1, 'USD')).toBe(10_000);
    expect(minorUnitsToMicros(1, 'KWD')).not.toBe(minorUnitsToMicros(1, 'USD'));
  });

  it('USD/EUR/GBP/SAR/AED cents convert at ×10_000 (micros per cent)', () => {
    for (const ccy of ['USD', 'EUR', 'GBP', 'SAR', 'AED']) {
      expect(minorUnitsToMicros(6000, ccy)).toBe(60_000_000); // 60.00 units
      expect(microsToMinorUnits(60_000_000, ccy)).toBe(6000);
    }
  });

  it('micros are never silently reinterpreted as cents: round-trips are exact or throw', () => {
    const m = moneyFromMinor('USD', 1234);
    expect(moneyToMicros(m)).toBe(12_340_000);
    expect(moneyFromMicros('USD', 12_340_000)).toEqual(m);
    // A micros value that is not a whole minor unit must throw, not round.
    expect(() => moneyFromMicros('USD', 12_345_678)).toThrow(/not a whole/);
    // But JPY has no sub-unit: 12_345_678 micros is not a whole yen either → throws.
    expect(() => moneyFromMicros('JPY', 12_345_678)).toThrow(/not a whole/);
    expect(moneyFromMicros('JPY', 12_000_000)).toEqual({ currency: 'JPY', minor: 12, exponent: 0 });
  });

  it('rejects non-integer minor amounts', () => {
    expect(() => moneyFromMinor('USD', 10.5)).toThrow(/integer/);
  });
});
