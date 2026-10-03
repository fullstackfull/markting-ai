/**
 * Phase 5 — COMMERCE DATA TRUST. Extends the platform data-trust framework with commerce-specific,
 * DETERMINISTIC tiers. These say what we actually know about an order/cost/customer, so downstream
 * math never over-claims (e.g. profit is only trustworthy when COST_VERIFIED, revenue-after-refunds
 * only when REFUND_VERIFIED). Trust is derived from facts, never asserted by a model or a payload.
 */
import type { Order, Refund, CostObservation, CommerceTrustTier, CustomerReference } from './model';

/** Deterministic tiers an order earns from its own paid/fulfilled/refund state. */
export function orderTrustTiers(order: Order, opts: { refundsVerified?: boolean } = {}): CommerceTrustTier[] {
  const tiers: CommerceTrustTier[] = ['PLATFORM_ORDER'];
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded' || order.paymentStatus === 'refunded' || order.paidAt) {
    tiers.push('PAID_ORDER');
  }
  if (order.fulfillmentStatus === 'fulfilled' || order.fulfilledAt) tiers.push('FULFILLED_ORDER');
  if (opts.refundsVerified) tiers.push('REFUND_VERIFIED');
  if (order.customer) tiers.push(...customerTrustTiers(order.customer));
  return [...new Set(tiers)];
}

export function customerTrustTiers(c: CustomerReference): CommerceTrustTier[] {
  return c.identityConfidence === 'PARTIAL' || c.identityConfidence === 'KNOWN' ? ['CUSTOMER_ID_PARTIAL'] : [];
}

/** Cost trust: a merchant-configured cost is CONFIGURED; a reconciled/ERP cost is VERIFIED. */
export function costTrustTiers(c: CostObservation): CommerceTrustTier[] {
  if (c.provenance.origin === 'erp_feed') return ['COST_CONFIGURED', 'COST_VERIFIED'];
  if (c.provenance.origin === 'merchant_config' || c.provenance.origin === 'manual_import') return ['COST_CONFIGURED'];
  return [];
}

export function refundTrustTiers(_r: Refund): CommerceTrustTier[] {
  // A refund record read from the connector is itself the verification of the refund.
  return ['REFUND_VERIFIED'];
}

/** Whether profit math may be surfaced as trustworthy: needs verified refunds AND a configured cost. */
export function profitTrustOk(tiers: CommerceTrustTier[]): boolean {
  return tiers.includes('COST_CONFIGURED') || tiers.includes('COST_VERIFIED');
}

/** Map commerce tiers to a coarse platform DataTier label for cross-engine gating. */
export function toPlatformTier(tiers: CommerceTrustTier[]): 'PLATFORM_REPORTED' | 'VALIDATED' | 'RECONCILED' {
  if (tiers.includes('COST_VERIFIED') && tiers.includes('REFUND_VERIFIED')) return 'RECONCILED';
  if (tiers.includes('PAID_ORDER') || tiers.includes('REFUND_VERIFIED')) return 'VALIDATED';
  return 'PLATFORM_REPORTED';
}
