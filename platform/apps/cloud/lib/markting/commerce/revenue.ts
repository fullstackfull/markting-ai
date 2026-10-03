/**
 * Phase 5J/5Q/5R — MERCHANT BUSINESS REVENUE engine. The terms are kept strictly distinct and never
 * mixed: Gross Sales (line value before discounts/refunds), Discounts, Refunds, Tax, Shipping, and Net
 * Revenue computed under an EXPLICIT, configured basis (which stages count, whether tax/shipping are
 * included, whether refunds/discounts are deducted). Nothing is chosen silently. Cancelled/failed/
 * unpaid orders are excluded unless the basis explicitly counts their stage. Refund-aware throughout.
 */
import {
  type Order, type Refund, type RevenueObservation, type RevenueBasis, type OrderStage,
  type CommerceMoney, zeroMoney,
} from './model';
import { assessDataQuality } from './data-quality';

/** The default, conservative basis: paid or fulfilled orders, excl. tax & shipping, net of refunds+discounts. */
export const DEFAULT_REVENUE_BASIS: RevenueBasis = {
  countStages: ['paid', 'fulfilled', 'partially_refunded', 'refunded'],
  includeTax: false,
  includeShipping: false,
  deductRefunds: true,
  deductDiscounts: true,
  label: 'net_paid_excl_tax_excl_shipping',
};

/** A gross sales basis (placed orders, gross, nothing deducted) — for comparison, never the default. */
export const GROSS_SALES_BASIS: RevenueBasis = {
  countStages: ['placed', 'paid', 'fulfilled', 'partially_refunded', 'refunded'],
  includeTax: true,
  includeShipping: true,
  deductRefunds: false,
  deductDiscounts: false,
  label: 'gross_sales_incl_tax_incl_shipping',
};

function orderCounts(stage: OrderStage, basis: RevenueBasis): boolean {
  return basis.countStages.includes(stage);
}

/**
 * Compute a RevenueObservation for a window under an explicit basis. Orders failing data-quality hard
 * checks are excluded. Mixed currency → mixedCurrency:true and monetary totals left at the first
 * currency's zero with a flag (the caller must not treat a mixed total as a real number).
 */
export function computeRevenue(input: {
  orders: Order[];
  refunds?: Refund[];
  window: { start: string; end: string };
  basis?: RevenueBasis;
  now?: number;
}): RevenueObservation {
  const basis = input.basis ?? DEFAULT_REVENUE_BASIS;
  const dq = assessDataQuality(input.orders, input.refunds ?? [], { now: input.now });
  const orders = input.orders.filter((o) => !dq.excludedOrderIds.has(o.orderId) && orderCounts(o.stage, basis));

  const currencies = new Set(orders.map((o) => o.currency));
  const mixedCurrency = currencies.size > 1;
  const currency = orders[0]?.currency ?? input.orders[0]?.currency ?? 'USD';

  const refundsByOrder = new Map<string, number>();
  for (const r of (input.refunds ?? [])) refundsByOrder.set(r.orderId, (refundsByOrder.get(r.orderId) ?? 0) + r.amount.minorUnits);

  let grossSales = 0, discounts = 0, refunds = 0, tax = 0, shipping = 0;
  for (const o of orders) {
    if (mixedCurrency) continue; // do not blend across currencies
    grossSales += o.subtotal.minorUnits + (o.discountTotal?.minorUnits ?? 0); // subtotal is already net of discount in most platforms; gross = subtotal+discount
    discounts += o.discountTotal?.minorUnits ?? 0;
    tax += o.taxTotal?.minorUnits ?? 0;
    shipping += o.shippingTotal?.minorUnits ?? 0;
    refunds += (o.refundedTotal?.minorUnits ?? 0) + (refundsByOrder.get(o.orderId) ?? 0);
  }

  let netMinor = grossSales;
  if (basis.deductDiscounts) netMinor -= discounts;
  if (basis.includeTax) netMinor += tax;
  if (basis.includeShipping) netMinor += shipping;
  if (basis.deductRefunds) netMinor -= refunds;

  const m = (minor: number): CommerceMoney => (mixedCurrency ? zeroMoney(currency) : { minorUnits: minor, currency });
  return {
    source: 'merchant',
    currency,
    basis,
    grossSales: m(grossSales),
    discounts: m(discounts),
    refunds: m(refunds),
    tax: m(tax),
    shipping: m(shipping),
    netRevenue: m(netMinor),
    orderCount: orders.length,
    window: input.window,
    mixedCurrency,
  };
}

// ---- Refund intelligence (5Q) ----
export interface RefundIntelligence {
  refundRateByCount: number;          // refunded orders / counted orders
  refundRateByValue?: number;         // refunded minor / gross minor (undefined on mixed currency)
  fullRefunds: number;
  partialRefunds: number;
  netAfterRefunds?: CommerceMoney;
  currency?: string;
  mixedCurrency: boolean;
}

export function refundIntelligence(orders: Order[], refunds: Refund[]): RefundIntelligence {
  const currencies = new Set([...orders.map((o) => o.currency), ...refunds.map((r) => r.amount.currency)]);
  const mixedCurrency = currencies.size > 1;
  const currency = orders[0]?.currency;
  const refundedOrderIds = new Set(refunds.map((r) => r.orderId));
  const full = refunds.filter((r) => r.kind === 'full').length;
  const partial = refunds.filter((r) => r.kind === 'partial').length;
  const grossMinor = orders.reduce((a, o) => a + o.grossTotal.minorUnits, 0);
  const refundMinor = refunds.reduce((a, r) => a + r.amount.minorUnits, 0);
  return {
    refundRateByCount: orders.length ? refundedOrderIds.size / orders.length : 0,
    refundRateByValue: mixedCurrency || !grossMinor ? undefined : refundMinor / grossMinor,
    fullRefunds: full,
    partialRefunds: partial,
    netAfterRefunds: mixedCurrency || !currency ? undefined : { minorUnits: grossMinor - refundMinor, currency },
    currency,
    mixedCurrency,
  };
}

// ---- Order status classification (5R) ----
export function revenueEligible(order: Order, basis: RevenueBasis = DEFAULT_REVENUE_BASIS): boolean {
  return basis.countStages.includes(order.stage);
}
