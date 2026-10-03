/**
 * Coherence Program 1.4 — ONE Money model at the orchestration boundary.
 *
 * The reassessment found three money representations: the canonical `Money` in @adport/core
 * (currency + integer minor + explicit exponent), commerce's `CommerceMoney` ({minorUnits, currency}
 * — which DROPS the exponent and so cannot safely round zero- or three-decimal currencies), and bare
 * `number` in intelligence. This module makes the canonical `Money` the single currency type every
 * orchestrated result surfaces: commerce money is lifted to canonical `Money` (recovering the exponent
 * from the ISO table, fail-closed on an unknown currency) the moment it enters the orchestrator.
 *
 * It intentionally does NOT rewrite commerce internals (that is the Program-25 deprecation, done only
 * after callers migrate). It is the canonical boundary adapter any surface MUST use when it renders a
 * monetary amount. Integration is PARTIAL: surfaces that render money (e.g. a dedicated commerce view)
 * lift through `fromCommerceMoney` here; the current composition still passes some commerce figures
 * through as opaque evidence detail (bare numbers inside `evidenceDetail`), which the commerce-surface
 * work (Program 6) will route through this adapter. So this module is the single money model to adopt,
 * not yet the money model every figure already flows through.
 */
import { type Money, moneyFromMinor, moneyToMicros, isKnownCurrency } from '@adport/core';

export type { Money };

/** A minimal structural view of commerce's `CommerceMoney` (avoids importing the commerce module). */
export interface MinorUnitsMoney {
  minorUnits: number;
  currency: string;
}

/**
 * Lift a commerce `{minorUnits, currency}` amount to the canonical `Money`, recovering the decimal
 * exponent from the ISO table. Fails closed (throws) on an unknown currency, exactly as the canonical
 * money helpers do — a currency we cannot scale must never be surfaced as a number.
 */
export function fromCommerceMoney(cm: MinorUnitsMoney): Money {
  return moneyFromMinor(cm.currency, cm.minorUnits);
}

/** Safe variant: returns undefined instead of throwing when the currency is unknown. */
export function tryFromCommerceMoney(cm: MinorUnitsMoney | null | undefined): Money | undefined {
  if (!cm || !isKnownCurrency(cm.currency)) return undefined;
  return moneyFromMinor(cm.currency, cm.minorUnits);
}

/** Canonical `Money` back to the commerce minor-units shape (for stores/engines not yet migrated). */
export function toCommerceMoney(money: Money): MinorUnitsMoney {
  return { minorUnits: money.minor, currency: money.currency };
}

/**
 * Compare two canonical amounts by value. Returns undefined when currencies differ — the orchestrator
 * never blends currencies (no invented FX), so a cross-currency comparison is explicitly "unknown".
 */
export function compareMoney(a: Money, b: Money): number | undefined {
  if (a.currency !== b.currency) return undefined;
  return moneyToMicros(a) - moneyToMicros(b);
}

/** A display-safe decimal string for a canonical amount (e.g. "1234.50"), never used for arithmetic. */
export function formatMoney(money: Money): string {
  const sign = money.minor < 0 ? '-' : '';
  const abs = Math.abs(money.minor);
  if (money.exponent === 0) return `${sign}${abs}`;
  const unit = 10 ** money.exponent;
  const whole = Math.floor(abs / unit);
  const frac = String(abs % unit).padStart(money.exponent, '0');
  return `${sign}${whole}.${frac}`;
}
