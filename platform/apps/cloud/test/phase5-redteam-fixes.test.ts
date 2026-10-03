import { describe, expect, it } from 'vitest';
import { computeRevenue, refundIntelligence } from '@/lib/markting/commerce/revenue';
import { assessDataQuality } from '@/lib/markting/commerce/data-quality';
import { computeMER } from '@/lib/markting/commerce/metrics';
import { makeConnector, type RawSource } from '@/lib/markting/commerce/providers';
import { redactPii, containsPii } from '@/lib/markting/commerce/pii';
import type { Order, Refund, CommerceMoney } from '@/lib/markting/commerce/model';

const SAR = (m: number): CommerceMoney => ({ minorUnits: m, currency: 'SAR' });
function order(over: Partial<Order> = {}): Order {
  return { orderId: 'o1', organizationId: 'o', storeId: 'salla:s1', platform: 'salla', externalOrderId: 'o1', createdAt: '2026-09-10', currency: 'SAR', subtotal: SAR(10000), grossTotal: SAR(10000), stage: 'paid', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled', lines: [{ lineId: 'l', sku: 'S', title: 't', quantity: 1, unitPrice: SAR(10000) }], provenance: { platform: 'salla', sourceId: 'o1', origin: 'connector_read', tiers: [] }, ...over };
}
const refund = (minor: number): Refund => ({ refundId: 'r1', orderId: 'o1', organizationId: 'o', storeId: 'salla:s1', platform: 'salla', externalRefundId: 'r1', amount: SAR(minor), kind: 'partial', refundedAt: '2026-09-12', provenance: { platform: 'salla', sourceId: 'r1', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] } });
const window = { start: '2026-09-01', end: '2026-09-30' };

describe('Phase-5 red-team fixes', () => {
  // #1 refund double-count: BOTH order-level refundedTotal AND a Refund row for the same refund.
  it('refund is counted ONCE when both sources are present (no double-count, no false exclusion)', () => {
    const o = order({ refundedTotal: SAR(4000) });
    const rev = computeRevenue({ orders: [o], refunds: [refund(4000)], window });
    expect(rev.refunds.minorUnits).toBe(4000);        // once, not 8000
    expect(rev.netRevenue.minorUnits).toBe(6000);     // 10000 - 4000
    expect(rev.orderCount).toBe(1);                   // not dropped by a false REFUND_EXCEEDS_ORDER
    const dq = assessDataQuality([o], [refund(4000)]);
    expect(dq.excludedOrderIds.has('o1')).toBe(false);
    expect(dq.issues.some((i) => i.code === 'REFUND_EXCEEDS_ORDER')).toBe(false);
  });
  it('a genuine over-refund is still caught', () => {
    const dq = assessDataQuality([order({ grossTotal: SAR(10000) })], [refund(15000)]);
    expect(dq.issues.some((i) => i.code === 'REFUND_EXCEEDS_ORDER')).toBe(true);
  });

  // #3 refundIntelligence must not ignore order-level refunds when no Refund rows are supplied.
  it('refundIntelligence counts order-level refundedTotal when the refund list is empty', () => {
    const ri = refundIntelligence([order({ grossTotal: SAR(10000), refundedTotal: SAR(3000) })], []);
    expect(ri.refundRateByValue).toBeCloseTo(0.3, 2);
    expect(ri.netAfterRefunds!.minorUnits).toBe(7000);
  });
  it('refundIntelligence does not double-count when both sources present', () => {
    const ri = refundIntelligence([order({ grossTotal: SAR(10000), refundedTotal: SAR(3000) })], [refund(3000)]);
    expect(ri.refundRateByValue).toBeCloseTo(0.3, 2); // once
  });

  // #4 MER must refuse platform-sourced revenue.
  it('computeMER refuses platform-sourced revenue (platform value is not MER revenue)', () => {
    const platform = computeMER({ basis: 'net', revenue: SAR(500000), source: 'platform', adSpend: SAR(100000), adSpendScope: 'all', window });
    expect(platform.value).toBeUndefined();
    expect(platform.notComputableReason).toMatch(/not merchant-sourced/);
    const merchant = computeMER({ basis: 'net', revenue: SAR(500000), source: 'merchant', adSpend: SAR(100000), adSpendScope: 'all', window });
    expect(merchant.value).toBe(5);
  });

  // #5 Salla tax-inclusive subtotal normalized to tax-exclusive so the excl-tax basis is honest.
  it('Salla subtotal is tax/shipping-exclusive (derived from total), so net excludes tax', async () => {
    const src: RawSource = { stores: async () => [], products: async () => ({ rows: [] }), refunds: async () => [], orders: async () => ({ rows: [{ id: 'o', store_id: 's1', currency: 'SAR', status: 'completed', paid_at: '2026-09-10', sub_total: 11500, tax: 1000, shipping_cost: 500, discount: 0, total: 11500 }] }) };
    const { orders } = await makeConnector('salla', src).listOrders({ connectionId: 'c', window });
    expect(orders[0]!.subtotal.minorUnits).toBe(10000); // 11500 total - 1000 tax - 500 shipping
    const rev = computeRevenue({ orders, window });    // default basis excludes tax+shipping
    expect(rev.netRevenue.minorUnits).toBe(10000);     // tax/shipping excluded, not smuggled in
  });

  // #6 PII redaction catches prefixed/nested keys (defense-in-depth).
  it('redactPii catches prefixed/nested PII keys (_billing_email, customer.email, shipping_address_1)', () => {
    const raw = { _billing_email: 'a@b.com', billing_phone: '+1', customer: { email: 'c@d.com', first_name: 'X' }, shipping_address_1: 'street', payment_method: 'visa', sku: 'OK' };
    const red = redactPii(raw);
    expect(containsPii(raw)).toBe(true);
    expect(containsPii(red)).toBe(false);
    expect((red as { _billing_email: string })._billing_email).toBe('[REDACTED]');
    expect((red as { customer: { email: string } }).customer.email).toBe('[REDACTED]');
    expect((red as { sku: string }).sku).toBe('OK');
  });
});
