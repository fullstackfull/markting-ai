/**
 * Phase 5M/5N/5O/5P — MER, blended CAC, customer identity, and OBSERVED (not predicted) LTV.
 *
 * MER is always reported WITH its revenue basis, ad-spend scope, window, currency and trust — never a
 * bare ratio. CAC is only computed when new-customer identity is reliable enough; anonymous orders do
 * not reveal new vs returning. LTV here is strictly observed (30/60/90-day revenue, repeat rate, AOV),
 * clearly labelled OBSERVED_LTV, never PREDICTED_LTV (predictive LTV is deferred).
 */
import type { CommerceMoney, Order, CustomerReference } from './model';

export type RevenueBasisLabel = 'gross' | 'net' | 'contribution';

export interface MER {
  basis: RevenueBasisLabel;
  value?: number;                  // revenue / ad spend; undefined when not computable
  revenue: CommerceMoney;
  adSpend: CommerceMoney;
  adSpendScope: string;            // e.g. 'all_channels', 'meta_only'
  window: { start: string; end: string };
  currency: string;
  mixedCurrency: boolean;
  trust: 'PLATFORM_REPORTED' | 'VALIDATED' | 'RECONCILED';
  notComputableReason?: string;
}

/** MER = merchant revenue / total ad spend, with the basis made explicit. Same-currency only. */
export function computeMER(input: {
  basis: RevenueBasisLabel;
  revenue: CommerceMoney;
  adSpend: CommerceMoney;
  adSpendScope: string;
  window: { start: string; end: string };
  trust?: MER['trust'];
}): MER {
  const mixedCurrency = input.revenue.currency !== input.adSpend.currency;
  const base: MER = {
    basis: input.basis,
    revenue: input.revenue,
    adSpend: input.adSpend,
    adSpendScope: input.adSpendScope,
    window: input.window,
    currency: input.revenue.currency,
    mixedCurrency,
    trust: input.trust ?? 'PLATFORM_REPORTED',
  };
  if (mixedCurrency) return { ...base, notComputableReason: 'revenue and ad spend are in different currencies — no governed FX layer' };
  if (input.adSpend.minorUnits <= 0) return { ...base, notComputableReason: 'ad spend is zero/unknown for the window' };
  return { ...base, value: Math.round((input.revenue.minorUnits / input.adSpend.minorUnits) * 100) / 100 };
}

// ---- Customer identity (5O) ----
export type CustomerClass = 'new' | 'returning' | 'unknown';

/**
 * Classify a customer new/returning given a set of prior-order pseudo-ids. If identity confidence is
 * UNKNOWN (anonymous order), classification stays 'unknown' — we never pretend to know.
 */
export function classifyCustomer(ref: CustomerReference | undefined, priorPseudoIds: Set<string>): { classification: CustomerClass; confidence: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' } {
  if (!ref || ref.identityConfidence === 'UNKNOWN' || !ref.pseudoId) return { classification: 'unknown', confidence: 'UNKNOWN' };
  return { classification: priorPseudoIds.has(ref.pseudoId) ? 'returning' : 'new', confidence: ref.identityConfidence };
}

// ---- Blended CAC (5N) ----
export interface BlendedCAC {
  value?: CommerceMoney;           // ad spend / new customers
  adSpend: CommerceMoney;
  newCustomers: number;
  knownCustomers: number;
  unknownCustomers: number;
  reliability: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  notComputableReason?: string;
}

/**
 * Blended CAC = total ad spend / new customers acquired — ONLY when new-customer identity is reliable.
 * If too many orders are anonymous (unknown identity), reliability is UNKNOWN and we refuse the number.
 */
export function blendedCAC(input: {
  adSpend: CommerceMoney;
  classifications: Array<{ classification: CustomerClass; confidence: 'KNOWN' | 'PARTIAL' | 'UNKNOWN' }>;
  minKnownShare?: number;          // default 0.5 — at least half the orders must have identity
}): BlendedCAC {
  const minKnownShare = input.minKnownShare ?? 0.5;
  const total = input.classifications.length;
  const unknown = input.classifications.filter((c) => c.confidence === 'UNKNOWN').length;
  const known = total - unknown;
  const newCustomers = input.classifications.filter((c) => c.classification === 'new').length;
  const knownShare = total ? known / total : 0;
  const reliability: BlendedCAC['reliability'] = total === 0 || knownShare < minKnownShare ? 'UNKNOWN' : knownShare === 1 ? 'KNOWN' : 'PARTIAL';
  const base: BlendedCAC = { adSpend: input.adSpend, newCustomers, knownCustomers: known, unknownCustomers: unknown, reliability };
  if (reliability === 'UNKNOWN') return { ...base, notComputableReason: `only ${Math.round(knownShare * 100)}% of orders have reliable customer identity (need ≥ ${Math.round(minKnownShare * 100)}%)` };
  if (newCustomers === 0) return { ...base, notComputableReason: 'no identified new customers in the window' };
  return { ...base, value: { minorUnits: Math.round(input.adSpend.minorUnits / newCustomers), currency: input.adSpend.currency } };
}

// ---- Observed LTV foundation (5P) ----
export interface ObservedLTV {
  kind: 'OBSERVED_LTV';            // never PREDICTED_LTV
  windowDays: 30 | 60 | 90;
  revenuePerCustomer?: CommerceMoney;
  ordersPerCustomer?: number;
  repeatPurchaseRate?: number;     // customers with >1 order / customers
  aov?: CommerceMoney;             // average order value
  cohortSize: number;
  reliability: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  notComputableReason?: string;
}

/**
 * Observed LTV over a fixed window from a cohort's orders. Requires reliable customer identity on
 * enough of the cohort; otherwise UNKNOWN. Single currency only.
 */
export function observedLTV(input: {
  windowDays: 30 | 60 | 90;
  orders: Order[];                 // orders within the window, with customer pseudo-ids
  currency: string;
  minKnownShare?: number;
}): ObservedLTV {
  const minKnownShare = input.minKnownShare ?? 0.5;
  const sameCur = input.orders.every((o) => o.currency === input.currency);
  const withId = input.orders.filter((o) => o.customer?.pseudoId && o.customer.identityConfidence !== 'UNKNOWN');
  const total = input.orders.length;
  const knownShare = total ? withId.length / total : 0;
  const base: ObservedLTV = { kind: 'OBSERVED_LTV', windowDays: input.windowDays, cohortSize: 0, reliability: 'UNKNOWN' };
  if (!sameCur) return { ...base, notComputableReason: 'mixed currency cohort' };
  if (total === 0 || knownShare < minKnownShare) return { ...base, notComputableReason: `insufficient customer identity (${Math.round(knownShare * 100)}%)` };

  const byCustomer = new Map<string, { orders: number; revenueMinor: number }>();
  for (const o of withId) {
    const id = o.customer!.pseudoId!;
    const cur = byCustomer.get(id) ?? { orders: 0, revenueMinor: 0 };
    cur.orders += 1; cur.revenueMinor += (o.netRevenue?.minorUnits ?? o.grossTotal.minorUnits);
    byCustomer.set(id, cur);
  }
  const cohort = byCustomer.size;
  const totalRevenue = [...byCustomer.values()].reduce((a, c) => a + c.revenueMinor, 0);
  const totalOrders = [...byCustomer.values()].reduce((a, c) => a + c.orders, 0);
  const repeat = [...byCustomer.values()].filter((c) => c.orders > 1).length;
  return {
    kind: 'OBSERVED_LTV',
    windowDays: input.windowDays,
    revenuePerCustomer: { minorUnits: Math.round(totalRevenue / cohort), currency: input.currency },
    ordersPerCustomer: Math.round((totalOrders / cohort) * 100) / 100,
    repeatPurchaseRate: Math.round((repeat / cohort) * 1000) / 1000,
    aov: { minorUnits: Math.round(totalRevenue / totalOrders), currency: input.currency },
    cohortSize: cohort,
    reliability: knownShare === 1 ? 'KNOWN' : 'PARTIAL',
  };
}
