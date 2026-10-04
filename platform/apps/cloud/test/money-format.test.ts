import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyMinor, MIXED_CURRENCY } from '@/components/ui';

/**
 * PHASE A (A2): no raw minor units in the UI; every amount respects its currency's exponent + locale;
 * mixed/unknown currency is labeled, never guessed.
 */
describe('formatMoneyMinor (minor units → localized currency)', () => {
  it('USD (2-decimal): 123450 minor → 1,234.50 with symbol', () => {
    const s = formatMoneyMinor(123450, 'USD', 'en');
    expect(s).toContain('1,234.50');
    expect(s).toContain('$');
  });
  it('JPY (zero-decimal): 5000 minor → 5,000 with no decimal places', () => {
    const s = formatMoneyMinor(5000, 'JPY', 'en');
    expect(s).toContain('5,000');
    expect(s).not.toContain('5,000.00');
  });
  it('KWD (3-decimal): 1500 minor → 1.500 (fils scaled by 10^3)', () => {
    const s = formatMoneyMinor(1500, 'KWD', 'en');
    expect(s).toContain('1.500');
  });
  it('no currency → labeled unknown, never guessed', () => {
    expect(formatMoneyMinor(123450, undefined, 'en')).toContain('currency unknown');
    expect(formatMoneyMinor(123450, '', 'en')).toContain('currency unknown');
  });
  it('unknown-exponent currency → shows the code without rescaling', () => {
    const s = formatMoneyMinor(1234, 'ZZZ', 'en');
    expect(s).toContain('ZZZ');
    expect(s).toContain('1,234');
  });
  it('MIXED_CURRENCY sentinel passes through', () => {
    expect(formatMoneyMinor(100, MIXED_CURRENCY, 'en')).toBe('MIXED_CURRENCY');
  });
  it('nullish/NaN → em dash', () => {
    expect(formatMoneyMinor(null, 'USD')).toBe('—');
    expect(formatMoneyMinor(Number.NaN, 'USD')).toBe('—');
  });
});

describe('formatMoney (whole units → localized currency, currency-correct decimals)', () => {
  it('JPY shows no decimals', () => {
    const s = formatMoney(5000, 'JPY', 'en');
    expect(s).toContain('5,000');
    expect(s).not.toContain('.00');
  });
  it('KWD shows 3 decimals', () => {
    expect(formatMoney(1.5, 'KWD', 'en')).toContain('1.500');
  });
  it('USD shows 2 decimals', () => {
    expect(formatMoney(1234.5, 'USD', 'en')).toContain('1,234.50');
  });
});
