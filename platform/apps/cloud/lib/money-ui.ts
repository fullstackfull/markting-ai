/**
 * PHASE A (A2) — client-safe ISO-4217 minor-unit exponents.
 *
 * A deliberate copy of `@adport/core`'s CURRENCY_EXPONENTS, kept core-free so it can be imported by
 * client components (e.g. components/ui.tsx) WITHOUT pulling the core barrel — which touches node:fs —
 * into the browser bundle. `test/currency-sync.test.ts` asserts this copy never drifts from core.
 */
export const CURRENCY_EXPONENTS_UI: Readonly<Record<string, number>> = Object.freeze({
  USD: 2, EUR: 2, GBP: 2, SAR: 2, AED: 2, QAR: 2, EGP: 2, MAD: 2, TRY: 2,
  CAD: 2, AUD: 2, CHF: 2, CNY: 2, INR: 2, BRL: 2, MXN: 2, ZAR: 2, SEK: 2,
  NOK: 2, DKK: 2, PLN: 2, SGD: 2, HKD: 2, NZD: 2, ILS: 2, RUB: 2, THB: 2,
  JPY: 0, KRW: 0, CLP: 0, ISK: 0, HUF: 0, TWD: 0, VND: 0, XOF: 0, XAF: 0,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, IQD: 3, LYD: 3,
});
