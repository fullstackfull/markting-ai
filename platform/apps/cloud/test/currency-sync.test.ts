import { describe, expect, it } from 'vitest';
import { CURRENCY_EXPONENTS } from '@adport/core';
import { CURRENCY_EXPONENTS_UI } from '@/lib/money-ui';

/** The client-safe currency-exponent copy must never drift from the canonical core table (Phase A / A2). */
describe('currency exponent copy stays in sync with @adport/core', () => {
  it('has identical keys and values', () => {
    expect(Object.keys(CURRENCY_EXPONENTS_UI).sort()).toEqual(Object.keys(CURRENCY_EXPONENTS).sort());
    for (const [code, exp] of Object.entries(CURRENCY_EXPONENTS)) {
      expect(CURRENCY_EXPONENTS_UI[code], code).toBe(exp);
    }
  });
});
