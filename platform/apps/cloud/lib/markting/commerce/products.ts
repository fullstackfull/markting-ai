/**
 * Phase 5 — PRODUCT / SKU intelligence, inventory foundation, and promotion context.
 *
 * Analyze top revenue / top profit / high-refund / high-CAC product groups and (where attribution
 * permits) product-ad alignment. Inventory reads are OPTIONAL and advisory only — diagnostics may flag
 * LOW_INVENTORY_RISK where reliable inventory data exists, but Phase 5 NEVER pauses advertising or acts
 * on inventory. Promotions are explicit periods so sale-period lifts are not treated as baseline.
 */
import type { Order, Refund, CommerceMoney } from './model';
import { CostBook, orderCogs } from './profit';

export interface ProductStat {
  sku: string;
  productId?: string;
  orders: number;
  units: number;
  revenueMinor: number;
  refundMinor: number;
  cogsMinor?: number;              // undefined if any unit cost unknown
  grossProfitMinor?: number;
  refundRate: number;
  currency: string;
}

/** Aggregate per-SKU stats for a single-currency set (mixed currency → caller must split first). */
export function productStats(orders: Order[], refunds: Refund[] = [], costBook = new CostBook()): ProductStat[] {
  const currency = orders[0]?.currency ?? 'USD';
  const stats = new Map<string, ProductStat>();
  const refundByOrder = new Map<string, number>();
  for (const r of refunds) refundByOrder.set(r.orderId, (refundByOrder.get(r.orderId) ?? 0) + r.amount.minorUnits);

  for (const o of orders) {
    if (o.currency !== currency) continue;
    const cogsByLine = orderCogs(o, costBook);
    const orderRefund = refundByOrder.get(o.orderId) ?? o.refundedTotal?.minorUnits ?? 0;
    const orderUnits = o.lines.reduce((a, l) => a + l.quantity, 0) || 1;
    for (const l of o.lines) {
      const sku = l.sku ?? l.productId ?? 'unknown';
      const s = stats.get(sku) ?? { sku, productId: l.productId, orders: 0, units: 0, revenueMinor: 0, refundMinor: 0, cogsMinor: 0, refundRate: 0, currency };
      s.orders += 1;
      s.units += l.quantity;
      const lineRevenue = l.netRevenue?.minorUnits ?? (l.unitPrice.minorUnits * l.quantity - (l.discountAllocated?.minorUnits ?? 0));
      s.revenueMinor += lineRevenue;
      s.refundMinor += Math.round(orderRefund * (l.quantity / orderUnits)); // allocate order refund by unit share
      const unitCost = costBook.unitCost({ sku: l.sku, productId: l.productId, variantId: l.variantId });
      if (unitCost && unitCost.unitCost.currency === currency && s.cogsMinor != null) s.cogsMinor += unitCost.unitCost.minorUnits * l.quantity;
      else s.cogsMinor = undefined; // any unknown cost → total COGS unknown for this SKU
      stats.set(sku, s);
    }
  }
  for (const s of stats.values()) {
    s.refundRate = s.revenueMinor ? Math.round((s.refundMinor / s.revenueMinor) * 1000) / 1000 : 0;
    if (s.cogsMinor != null) s.grossProfitMinor = s.revenueMinor - s.refundMinor - s.cogsMinor;
  }
  return [...stats.values()];
}

export function topByRevenue(stats: ProductStat[], n = 10): ProductStat[] {
  return [...stats].sort((a, b) => b.revenueMinor - a.revenueMinor).slice(0, n);
}
export function topByProfit(stats: ProductStat[], n = 10): ProductStat[] {
  return [...stats].filter((s) => s.grossProfitMinor != null).sort((a, b) => (b.grossProfitMinor ?? 0) - (a.grossProfitMinor ?? 0)).slice(0, n);
}
export function highRefund(stats: ProductStat[], threshold = 0.15): ProductStat[] {
  return stats.filter((s) => s.refundRate >= threshold).sort((a, b) => b.refundRate - a.refundRate);
}

// ---- Inventory foundation (advisory only) ----
export type InventoryFlag = { sku?: string; variantId?: string; onHand: number; state: 'LOW_INVENTORY_RISK' | 'OK'; };

/** Flag low inventory where RELIABLE inventory data exists. Never pauses ads — advisory only. */
export function inventoryRisk(levels: Array<{ sku?: string; variantId?: string; onHand: number }>, lowThreshold = 10): InventoryFlag[] {
  return levels.map((l) => ({ ...l, state: l.onHand <= lowThreshold ? 'LOW_INVENTORY_RISK' : 'OK' }));
}

// ---- Promotions ----
export interface Promotion {
  id: string;
  label: string;
  start: string;
  end: string;
  discountPct?: number;
  productIds?: string[];
  channels?: string[];
}

/** Whether an order falls inside a promotion period (so its lift is not treated as baseline). */
export function inPromotion(order: Order, promos: Promotion[]): Promotion[] {
  const t = Date.parse(order.createdAt);
  return promos.filter((p) => t >= Date.parse(p.start) && t <= Date.parse(p.end));
}

/** Split orders into promo vs baseline so analysis never treats a sale lift as normal. */
export function partitionByPromotion(orders: Order[], promos: Promotion[]): { promo: Order[]; baseline: Order[] } {
  const promo: Order[] = []; const baseline: Order[] = [];
  for (const o of orders) (inPromotion(o, promos).length ? promo : baseline).push(o);
  return { promo, baseline };
}

// ---- Creative × commerce linkage (gated by attribution trust) ----
export interface CreativeCommerceLink {
  creativeRef: string;
  orders: number;
  revenueMinor: number;
  refundMinor: number;
  profitMinor?: number;
  currency: string;
  /** Whether attribution is strong enough to claim creative-level profit (DIRECTLY_TAGGED only). */
  attributionTrusted: boolean;
  caveat?: string;
}

/**
 * Link creatives to orders → revenue → refund → profit ONLY where attribution is strong (a hashed
 * provider click id). With weak attribution (UTM/referrer), we refuse a profitability claim and return
 * a caveat instead of a number.
 */
export function creativeCommerceLinks(input: {
  orders: Order[];
  refunds?: Refund[];
  costBook?: CostBook;
  /** Map an order to a creative ref using DIRECTLY_TAGGED click ids only. */
  creativeOf: (o: Order) => { ref: string; directlyTagged: boolean } | null;
}): CreativeCommerceLink[] {
  const book = input.costBook ?? new CostBook();
  const refundByOrder = new Map<string, number>();
  for (const r of (input.refunds ?? [])) refundByOrder.set(r.orderId, (refundByOrder.get(r.orderId) ?? 0) + r.amount.minorUnits);
  const byRef = new Map<string, { link: CreativeCommerceLink; allTagged: boolean; cogsKnown: boolean }>();
  for (const o of input.orders) {
    const c = input.creativeOf(o);
    if (!c) continue;
    const entry = byRef.get(c.ref) ?? { link: { creativeRef: c.ref, orders: 0, revenueMinor: 0, refundMinor: 0, profitMinor: 0, currency: o.currency, attributionTrusted: true }, allTagged: true, cogsKnown: true };
    entry.link.orders += 1;
    entry.link.revenueMinor += o.netRevenue?.minorUnits ?? o.grossTotal.minorUnits;
    entry.link.refundMinor += refundByOrder.get(o.orderId) ?? o.refundedTotal?.minorUnits ?? 0;
    const cogs = orderCogs(o, book).cogs;
    if (cogs) entry.link.profitMinor = (entry.link.profitMinor ?? 0) + (o.netRevenue?.minorUnits ?? o.grossTotal.minorUnits) - cogs.minorUnits; else entry.cogsKnown = false;
    if (!c.directlyTagged) entry.allTagged = false;
    byRef.set(c.ref, entry);
  }
  return [...byRef.values()].map(({ link, allTagged, cogsKnown }) => ({
    ...link,
    profitMinor: cogsKnown && allTagged ? link.profitMinor : undefined,
    attributionTrusted: allTagged,
    caveat: allTagged ? (cogsKnown ? undefined : 'COGS unknown for some orders — profit withheld') : 'attribution too weak (UTM/last-touch) — creative-level profitability not claimed',
  }));
}
