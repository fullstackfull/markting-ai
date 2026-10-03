/**
 * Phase 5K/5L/5Y — COGS, MARGIN, CONTRIBUTION, and BREAK-EVEN.
 *
 * Hard rules:
 *  - COGS is NEVER inferred from selling price. Unknown cost stays UNKNOWN (undefined), never 0.
 *  - COGS carries provenance/trust (merchant_config → CONFIGURED, erp_feed → VERIFIED).
 *  - Margin is computed only when inputs permit; otherwise a notComputableReason is returned.
 *  - Contribution-margin definition is ORG-CONFIGURABLE (which cost components to include); we never
 *    assume every organization uses the same definition.
 *  - Break-even returns BREAK_EVEN_UNKNOWN rather than inventing a number when inputs are missing.
 */
import {
  type Order, type CostObservation, type MarginObservation, type CommerceMoney, type RevenueObservation,
  zeroMoney,
} from './model';

/** A per-sku/product cost lookup built from trusted CostObservations (latest effective wins). */
export class CostBook {
  private bySku = new Map<string, CostObservation>();
  private byProduct = new Map<string, CostObservation>();
  constructor(costs: CostObservation[] = []) { for (const c of costs) this.add(c); }
  add(c: CostObservation): void {
    if (c.sku) this.bySku.set(c.sku, c);
    if (c.productId) this.byProduct.set(c.productId, c);
    if (c.variantId) this.byProduct.set(c.variantId, c);
  }
  /** Unit cost for a line, or null if UNKNOWN (never a guess). */
  unitCost(ref: { sku?: string; productId?: string; variantId?: string }): CostObservation | null {
    return (ref.sku && this.bySku.get(ref.sku)) || (ref.variantId && this.byProduct.get(ref.variantId)) || (ref.productId && this.byProduct.get(ref.productId)) || null;
  }
  get size(): number { return this.bySku.size + this.byProduct.size; }
}

/** Total COGS for an order, or null if ANY line's cost is unknown (partial COGS is not a trusted total). */
export function orderCogs(order: Order, book: CostBook): { cogs: CommerceMoney | null; knownLines: number; totalLines: number } {
  let minor = 0; let known = 0;
  for (const l of order.lines) {
    const c = book.unitCost({ sku: l.sku, productId: l.productId, variantId: l.variantId });
    if (!c) continue;
    if (c.unitCost.currency !== order.currency) continue; // never blend currency into COGS
    minor += c.unitCost.minorUnits * l.quantity;
    known += 1;
  }
  const allKnown = known === order.lines.length && order.lines.length > 0;
  return { cogs: allKnown ? { minorUnits: minor, currency: order.currency } : null, knownLines: known, totalLines: order.lines.length };
}

/** Organisation contribution-margin definition — which costs count beyond COGS. */
export interface ContributionConfig {
  includeCogs: boolean;
  includePaymentFees: boolean;
  includeShipping: boolean;
  includeFulfillment: boolean;
  includeDiscounts: boolean;
  includeAdSpend: boolean;
  label: string;
}

export const DEFAULT_CONTRIBUTION_CONFIG: ContributionConfig = {
  includeCogs: true, includePaymentFees: false, includeShipping: false, includeFulfillment: false,
  includeDiscounts: false, includeAdSpend: false, label: 'cogs_only',
};

export interface MarginInputs {
  netRevenue: CommerceMoney;          // merchant net revenue (same currency)
  cogs?: CommerceMoney | null;        // UNKNOWN → undefined/null (never 0)
  paymentFees?: CommerceMoney;
  shipping?: CommerceMoney;
  fulfillment?: CommerceMoney;
  discounts?: CommerceMoney;
  adSpend?: CommerceMoney;
}

/** Compute gross + contribution margin under an explicit config. Returns a reason if not computable. */
export function computeMargin(inputs: MarginInputs, config: ContributionConfig = DEFAULT_CONTRIBUTION_CONFIG): MarginObservation {
  const currency = inputs.netRevenue.currency;
  const components: string[] = [];
  const sameCur = (m?: CommerceMoney | null): boolean => !m || m.currency === currency;
  if (![inputs.cogs, inputs.paymentFees, inputs.shipping, inputs.fulfillment, inputs.discounts, inputs.adSpend].every(sameCur)) {
    return { contributionComponents: [], notComputableReason: 'cost components are in a different currency than revenue', currency };
  }

  // Gross profit requires COGS.
  if (inputs.cogs == null) {
    return { contributionComponents: [], notComputableReason: 'COGS unknown — margin/profit cannot be computed (never inferred from price)', currency };
  }
  const net = inputs.netRevenue.minorUnits;
  const grossProfitMinor = net - inputs.cogs.minorUnits;
  const grossMarginPct = net !== 0 ? (grossProfitMinor / net) * 100 : undefined;

  let contribMinor = net;
  if (config.includeCogs) { contribMinor -= inputs.cogs.minorUnits; components.push('cogs'); }
  if (config.includePaymentFees && inputs.paymentFees) { contribMinor -= inputs.paymentFees.minorUnits; components.push('payment_fees'); }
  if (config.includeShipping && inputs.shipping) { contribMinor -= inputs.shipping.minorUnits; components.push('shipping'); }
  if (config.includeFulfillment && inputs.fulfillment) { contribMinor -= inputs.fulfillment.minorUnits; components.push('fulfillment'); }
  if (config.includeDiscounts && inputs.discounts) { contribMinor -= inputs.discounts.minorUnits; components.push('discounts'); }
  if (config.includeAdSpend && inputs.adSpend) { contribMinor -= inputs.adSpend.minorUnits; components.push('ad_spend'); }

  return {
    grossProfit: { minorUnits: grossProfitMinor, currency },
    grossMarginPct: grossMarginPct != null ? Math.round(grossMarginPct * 10) / 10 : undefined,
    contributionProfit: { minorUnits: contribMinor, currency },
    contributionMarginPct: net !== 0 ? Math.round((contribMinor / net) * 1000) / 10 : undefined,
    contributionComponents: components,
    currency,
  };
}

// ---- Break-even ROAS (5Y) ----
export type BreakEven = { state: 'BREAK_EVEN_KNOWN'; breakEvenRoas: number; contributionMarginPct: number; methodology: string }
  | { state: 'BREAK_EVEN_UNKNOWN'; reason: string };

/**
 * Break-even ROAS = 1 / contribution-margin-fraction (before ad spend). If an order's contribution
 * margin (excluding ad spend) is e.g. 40%, you break even when revenue per ad-dollar ≥ 1/0.40 = 2.5.
 * Requires a trusted contribution margin that EXCLUDES ad spend; otherwise BREAK_EVEN_UNKNOWN.
 */
export function breakEvenRoas(margin: MarginObservation): BreakEven {
  if (margin.contributionMarginPct == null || margin.contributionComponents.includes('ad_spend')) {
    return { state: 'BREAK_EVEN_UNKNOWN', reason: margin.notComputableReason ?? 'need a trusted contribution margin excluding ad spend' };
  }
  const frac = margin.contributionMarginPct / 100;
  if (frac <= 0) return { state: 'BREAK_EVEN_UNKNOWN', reason: 'non-positive contribution margin — no finite break-even ROAS' };
  return {
    state: 'BREAK_EVEN_KNOWN',
    breakEvenRoas: Math.round((1 / frac) * 100) / 100,
    contributionMarginPct: margin.contributionMarginPct,
    methodology: 'break_even_roas = 1 / contribution_margin_fraction (contribution excludes ad spend)',
  };
}

/** Profit computability guard — profit is valid ONLY on merchant revenue with known COGS. */
export function profitComputability(rev: RevenueObservation | null, cogs: CommerceMoney | null): string | null {
  if (!rev) return 'no merchant revenue connected (platform conversion value is not revenue)';
  if (rev.source !== 'merchant') return 'revenue is not merchant-sourced';
  if (rev.mixedCurrency) return 'mixed currency — profit not computable without a governed FX layer';
  if (cogs == null) return 'COGS unknown — margin/profit cannot be computed';
  return null;
}

export { zeroMoney };
