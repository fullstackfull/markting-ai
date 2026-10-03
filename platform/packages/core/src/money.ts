import { AdportError } from './errors.js';

/**
 * ONE canonical money representation for the whole write path. A monetary amount is an explicit
 * (currency, integer-minor-units) pair plus the currency's decimal exponent. There is no float, no
 * ambiguous "number of dollars/cents/micros" field: conversions to and from a provider's native
 * unit are explicit and currency-aware, so a zero-decimal currency (JPY, KRW) can never be inflated
 * 100× and a three-decimal currency (KWD, BHD, OMR) can never be under-set 10×.
 *
 * `minor` is an integer count of the currency's smallest unit (e.g. cents for USD, whole yen for
 * JPY, fils for KWD). `exponent` is how many decimal places that currency has. `micros` (1e-6 of a
 * whole unit) is the normalized cross-currency integer used by the policy engine and BudgetDelta;
 * micros = minor × 10^(6 − exponent).
 */
export interface Money {
  /** ISO-4217 alpha code, uppercase. */
  currency: string;
  /** Integer amount in the currency's minor unit. */
  minor: number;
  /** Decimal places for this currency (2 for USD, 0 for JPY, 3 for KWD). */
  exponent: number;
}

/**
 * ISO-4217 minor-unit exponents. Deliberately explicit (no default): a currency not in this table
 * fails closed rather than silently assuming 2 decimals. Covers the required Phase-0 matrix plus the
 * common and Gulf currencies the product targets. Extend consciously.
 */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  // 2-decimal (the common case)
  USD: 2, EUR: 2, GBP: 2, SAR: 2, AED: 2, QAR: 2, EGP: 2, MAD: 2, TRY: 2,
  CAD: 2, AUD: 2, CHF: 2, CNY: 2, INR: 2, BRL: 2, MXN: 2, ZAR: 2, SEK: 2,
  NOK: 2, DKK: 2, PLN: 2, SGD: 2, HKD: 2, NZD: 2, ILS: 2, RUB: 2, THB: 2,
  // 0-decimal
  JPY: 0, KRW: 0, CLP: 0, ISK: 0, HUF: 0, TWD: 0, VND: 0, XOF: 0, XAF: 0,
  // 3-decimal
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3,
});

export const MICROS_PER_UNIT = 1_000_000;

/** The minor-unit exponent for a currency, or fail closed for an unknown currency. */
export function currencyExponent(currency: string): number {
  const code = currency.trim().toUpperCase();
  const exponent = CURRENCY_EXPONENTS[code];
  if (exponent === undefined) {
    throw new AdportError(
      'INVALID_INPUT',
      `Unknown currency "${currency}" — refusing to convert a monetary amount with an unknown decimal exponent. Add it to CURRENCY_EXPONENTS only when its minor-unit scale is confirmed.`,
    );
  }
  return exponent;
}

export function isKnownCurrency(currency: string): boolean {
  return CURRENCY_EXPONENTS[currency.trim().toUpperCase()] !== undefined;
}

/** Build a Money from an integer minor-unit amount in a known currency. */
export function moneyFromMinor(currency: string, minor: number): Money {
  const code = currency.trim().toUpperCase();
  const exponent = currencyExponent(code);
  if (!Number.isInteger(minor)) {
    throw new AdportError('INVALID_INPUT', `Minor-unit amount must be an integer, got ${minor} ${code}`);
  }
  return { currency: code, minor, exponent };
}

/** Normalize a Money to micros (1e-6 of a whole unit): the cross-currency integer the engine uses. */
export function moneyToMicros(money: Money): number {
  const scale = MICROS_PER_UNIT / 10 ** money.exponent; // 10^(6 - exponent)
  return money.minor * scale;
}

/** Reconstruct a Money from micros for a known currency; micros must map to an integer minor unit. */
export function moneyFromMicros(currency: string, micros: number): Money {
  const code = currency.trim().toUpperCase();
  const exponent = currencyExponent(code);
  const scale = MICROS_PER_UNIT / 10 ** exponent; // 10^(6 - exponent)
  if (!Number.isInteger(micros) || micros % scale !== 0) {
    throw new AdportError(
      'INVALID_INPUT',
      `${micros} micros is not a whole ${code} minor unit (scale ${scale}); refusing a lossy conversion.`,
    );
  }
  return { currency: code, minor: micros / scale, exponent };
}

/** A provider's native minor-unit budget (Meta cents, whole yen, fils) → canonical micros. */
export function minorUnitsToMicros(minor: number, currency: string): number {
  return moneyToMicros(moneyFromMinor(currency, minor));
}

/** Canonical micros → a provider's native minor-unit budget for a known currency. */
export function microsToMinorUnits(micros: number, currency: string): number {
  return moneyFromMicros(currency, micros).minor;
}
