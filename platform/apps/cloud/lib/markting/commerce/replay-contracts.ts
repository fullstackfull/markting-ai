import 'server-only';

/**
 * PHASE C.6 (12) — COMMERCE REPLAY / CONTRACT FIXTURES.
 *
 * Deterministic captured-sample -> expected-canonical-entity contracts for the four real platforms
 * (Shopify / WooCommerce / Salla / Zid). Each contract runs the REAL provider normalizer over a captured
 * raw sample and asserts the resulting canonical Order/Product/Refund, proving the connector/transport maps
 * correctly WITHOUT a live store. Classification is FIXTURE_PROVEN.
 *
 * MERCHANT-TRUTH INVARIANT: every captured order carries a planted ad-platform conversion value in its raw
 * bag that differs from the merchant total. `assertMerchantTruthOnly` FAILS if any canonical revenue figure
 * reflects that ad value, if COGS was inferred at the connector/transport layer, or if netRevenue was
 * computed without an explicit basis. Commerce truth is merchant truth only.
 */
import { makeConnector, type RawSource } from './providers';
import type { CommercePlatform, Order, Product, Refund } from './model';
import type { SyncWindow } from './connector';

const WIDE: SyncWindow = { start: '1970-01-01', end: '2999-01-01' };

/** Expected canonical scalars for the order a contract maps to (merchant truth, all minor units). */
export interface ExpectedOrder {
  orderId: string;
  currency: string;
  stage: Order['stage'];
  paymentStatus: Order['paymentStatus'];
  fulfillmentStatus: Order['fulfillmentStatus'];
  grossMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  refundedMinor: number;
  lineCount: number;
}

export interface ExpectedProduct { productId: string; title: string; sku?: string }
export interface ExpectedRefund { refundId: string; amountMinor: number; kind: Refund['kind'] }

/** A planted ad-platform conversion value vs the real merchant gross — the merchant-truth probe. */
export interface MerchantTruthProbe {
  adConversionValueMinor: number;
  merchantGrossMinor: number;
}

export interface ReplayContract {
  platform: CommercePlatform;
  name: string;
  classification: 'FIXTURE_PROVEN';
  captured: {
    stores?: unknown[];
    orders?: unknown[];
    products?: unknown[];
    refunds?: unknown[];
  };
  expect: {
    order?: ExpectedOrder;
    product?: ExpectedProduct;
    refund?: ExpectedRefund;
  };
  merchantTruth: MerchantTruthProbe;
}

/** Build a connector RawSource backed by a contract's captured sample (single page, no live client). */
function contractSource(c: ReplayContract): RawSource {
  return {
    async stores() { return c.captured.stores ?? []; },
    async orders(_c, _w, cursor) { return cursor ? { rows: [] } : { rows: c.captured.orders ?? [], nextCursor: undefined }; },
    async products(_c, cursor) { return cursor ? { rows: [] } : { rows: c.captured.products ?? [] }; },
    async refunds() { return c.captured.refunds ?? []; },
  };
}

/** Run the REAL provider normalizer over a contract's captured sample. Deterministic; no network. */
export async function runReplayContract(c: ReplayContract): Promise<{ order?: Order; product?: Product; refund?: Refund }> {
  const connector = makeConnector(c.platform, contractSource(c));
  const order = c.captured.orders?.length ? (await connector.listOrders({ connectionId: 'replay', window: WIDE })).orders[0] : undefined;
  const product = c.captured.products?.length ? (await connector.listProducts({ connectionId: 'replay' })).products[0] : undefined;
  const refund = c.captured.refunds?.length ? (await connector.listRefunds({ connectionId: 'replay', window: WIDE }))[0] : undefined;
  return { order, product, refund };
}

/** Compare the normalized entities against the contract's expectations. Returns a list of mismatches. */
export function checkReplayContract(c: ReplayContract, got: { order?: Order; product?: Product; refund?: Refund }): string[] {
  const fail: string[] = [];
  const eq = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) fail.push(`${c.name}: ${label} expected ${String(expected)}, got ${String(actual)}`);
  };
  const eo = c.expect.order;
  if (eo) {
    const o = got.order;
    if (!o) { fail.push(`${c.name}: expected an order, got none`); }
    else {
      eq('order.orderId', o.orderId, eo.orderId);
      eq('order.currency', o.currency, eo.currency);
      eq('order.stage', o.stage, eo.stage);
      eq('order.paymentStatus', o.paymentStatus, eo.paymentStatus);
      eq('order.fulfillmentStatus', o.fulfillmentStatus, eo.fulfillmentStatus);
      eq('order.grossTotal', o.grossTotal.minorUnits, eo.grossMinor);
      eq('order.subtotal', o.subtotal.minorUnits, eo.subtotalMinor);
      eq('order.taxTotal', o.taxTotal?.minorUnits ?? 0, eo.taxMinor);
      eq('order.refundedTotal', o.refundedTotal?.minorUnits ?? 0, eo.refundedMinor);
      eq('order.lines.length', o.lines.length, eo.lineCount);
    }
  }
  const ep = c.expect.product;
  if (ep) {
    const p = got.product;
    if (!p) { fail.push(`${c.name}: expected a product, got none`); }
    else { eq('product.productId', p.productId, ep.productId); eq('product.title', p.title, ep.title); if (ep.sku !== undefined) eq('product.sku', p.sku, ep.sku); }
  }
  const er = c.expect.refund;
  if (er) {
    const r = got.refund;
    if (!r) { fail.push(`${c.name}: expected a refund, got none`); }
    else { eq('refund.refundId', r.refundId, er.refundId); eq('refund.amount', r.amount.minorUnits, er.amountMinor); eq('refund.kind', r.kind, er.kind); }
  }
  return fail;
}

/**
 * MERCHANT-TRUTH-ONLY invariant. Throws if a canonical revenue figure was derived from the ad-platform
 * conversion value, if COGS was inferred at the connector/transport layer, or if netRevenue was computed
 * without an explicit basis. Commerce connectors report merchant truth only.
 */
export function assertMerchantTruthOnly(order: Order, probe: MerchantTruthProbe): void {
  const adv = probe.adConversionValueMinor;
  const merch = probe.merchantGrossMinor;
  // Revenue must reflect MERCHANT truth, never the planted ad conversion value.
  if (adv !== merch && order.grossTotal.minorUnits === adv) {
    throw new Error('MERCHANT_TRUTH_VIOLATION: grossTotal derived from ad conversion value');
  }
  if (order.grossTotal.minorUnits !== merch) {
    throw new Error(`MERCHANT_TRUTH_VIOLATION: grossTotal ${order.grossTotal.minorUnits} does not reflect merchant total ${merch}`);
  }
  if (order.subtotal.minorUnits === adv && adv !== merch) {
    throw new Error('MERCHANT_TRUTH_VIOLATION: subtotal derived from ad conversion value');
  }
  // The connector must NOT infer COGS anywhere (cost comes only from a trusted cost source, out of band).
  for (const l of order.lines) {
    if (l.cogs !== undefined) throw new Error(`MERCHANT_TRUTH_VIOLATION: COGS inferred on line ${l.lineId} at connector/transport layer`);
  }
  // The connector must NOT compute netRevenue; the revenue engine does, under an explicit declared basis.
  if (order.netRevenue !== undefined) {
    throw new Error('MERCHANT_TRUTH_VIOLATION: netRevenue computed without an explicit revenue basis');
  }
}

// ---- The four platform replay contracts (captured samples carry a planted ad_conversion_value in raw) ----

const SHOPIFY_CONTRACT: ReplayContract = {
  platform: 'shopify', name: 'shopify/order-paid-unfulfilled', classification: 'FIXTURE_PROVEN',
  captured: {
    orders: [{
      id: '55', store_id: 's1', currency: 'USD', financial_status: 'paid', fulfillment_status: null,
      subtotal_price: '90.00', total_tax: '5.00', total_discounts: '0.00', current_total_price: '95.00',
      processed_at: '2026-09-10T00:00:00Z', created_at: '2026-09-10T00:00:00Z',
      line_items: [{ id: 'li', product_id: 'p', variant_id: 'v', title: 't', quantity: 1, price: '90.00' }],
      refunds: [], ad_conversion_value: '777.00',
    }],
    products: [{ id: 'sp1', title: 'Shirt', variants: [{ id: 'v1', sku: 'V1', title: 'M' }] }],
    refunds: [{ id: 'sr1', store_id: 's1', order_id: '55', currency: 'USD', amount: '25.00', created_at: '2026-09-12T00:00:00Z', note: 'damaged' }],
  },
  expect: {
    order: { orderId: 'shopify:s1:55', currency: 'USD', stage: 'paid', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', grossMinor: 9500, subtotalMinor: 9000, taxMinor: 500, refundedMinor: 0, lineCount: 1 },
    product: { productId: 'shopify:sp1', title: 'Shirt' },
    refund: { refundId: 'shopify:sr1', amountMinor: 2500, kind: 'partial' },
  },
  merchantTruth: { adConversionValueMinor: 77700, merchantGrossMinor: 9500 },
};

const WOO_CONTRACT: ReplayContract = {
  platform: 'woocommerce', name: 'woocommerce/order-completed-partial-refund', classification: 'FIXTURE_PROVEN',
  captured: {
    orders: [{
      id: '7', store_id: 's1', currency: 'USD', status: 'completed', date_paid: '2026-09-10', date_created: '2026-09-10T00:00:00Z',
      total: '100.00', total_tax: '0.00', shipping_total: '0.00', discount_total: '0.00',
      line_items: [{ id: 'l', product_id: 'p', name: 'n', quantity: 1, price: '100.00' }],
      refunds: [{ total: '-25.00' }], meta_data: [{ key: '_wc_order_attribution_utm_source', value: 'google' }],
      ad_conversion_value: '55.00',
    }],
    products: [{ id: 'wp1', sku: 'WSKU', name: 'Mug' }],
    refunds: [{ id: 'wr1', store_id: 's1', order_id: '7', currency: 'USD', total: '-25.00', date_created: '2026-09-12T00:00:00Z', reason: 'partial' }],
  },
  expect: {
    order: { orderId: 'woocommerce:s1:7', currency: 'USD', stage: 'fulfilled', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled', grossMinor: 10000, subtotalMinor: 10000, taxMinor: 0, refundedMinor: 2500, lineCount: 1 },
    product: { productId: 'woocommerce:wp1', title: 'Mug', sku: 'WSKU' },
    refund: { refundId: 'woocommerce:wr1', amountMinor: 2500, kind: 'partial' },
  },
  merchantTruth: { adConversionValueMinor: 5500, merchantGrossMinor: 10000 },
};

const SALLA_CONTRACT: ReplayContract = {
  platform: 'salla', name: 'salla/order-completed-tax-inclusive', classification: 'FIXTURE_PROVEN',
  captured: {
    orders: [{
      id: 'o1', store_id: 's1', currency: 'SAR', status: 'completed', paid_at: '2026-09-10T00:00:00Z', created_at: '2026-09-10T00:00:00Z',
      sub_total: 9000, tax: 1000, shipping_cost: 500, discount: 0, total: 10500, refunded: 0,
      items: [{ id: 'i1', product_id: 'p1', name: 'x', quantity: 2, price: 4500 }],
      ad_conversion_value: 99999,
    }],
    products: [{ id: 'p1', sku: 'SKU1', name: 'Widget' }],
    refunds: [{ id: 'r1', store_id: 's1', order_id: 'o1', currency: 'SAR', amount: 5000, order_total: 10500, created_at: '2026-09-12T00:00:00Z', reason: 'customer' }],
  },
  expect: {
    order: { orderId: 'salla:s1:o1', currency: 'SAR', stage: 'fulfilled', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled', grossMinor: 10500, subtotalMinor: 9000, taxMinor: 1000, refundedMinor: 0, lineCount: 1 },
    product: { productId: 'salla:p1', title: 'Widget', sku: 'SKU1' },
    refund: { refundId: 'salla:r1', amountMinor: 5000, kind: 'partial' },
  },
  merchantTruth: { adConversionValueMinor: 99999, merchantGrossMinor: 10500 },
};

const ZID_CONTRACT: ReplayContract = {
  platform: 'zid', name: 'zid/order-delivered-paid', classification: 'FIXTURE_PROVEN',
  captured: {
    orders: [{
      id: 'z1', store_id: 's1', currency: 'SAR', order_status: 'delivered', is_paid: true,
      created_at: '2026-09-10T00:00:00Z', delivered_at: '2026-09-11T00:00:00Z',
      order_total: 20000, tax: 0, shipping: 0, refunded_amount: 0,
      products: [{ id: 'p', name: 'n', quantity: 1, price: 20000 }],
      ad_conversion_value: 88888,
    }],
    products: [{ id: 'zp1', sku: 'ZSKU', name: 'Zid Item' }],
    refunds: [{ id: 'zr1', store_id: 's1', order_id: 'z1', currency: 'SAR', amount: 5000, type: 'partial', created_at: '2026-09-12T00:00:00Z' }],
  },
  expect: {
    order: { orderId: 'zid:s1:z1', currency: 'SAR', stage: 'fulfilled', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled', grossMinor: 20000, subtotalMinor: 20000, taxMinor: 0, refundedMinor: 0, lineCount: 1 },
    product: { productId: 'zid:zp1', title: 'Zid Item', sku: 'ZSKU' },
    refund: { refundId: 'zid:zr1', amountMinor: 5000, kind: 'partial' },
  },
  merchantTruth: { adConversionValueMinor: 88888, merchantGrossMinor: 20000 },
};

/** All four platform replay contracts. */
export const REPLAY_CONTRACTS: ReplayContract[] = [SHOPIFY_CONTRACT, WOO_CONTRACT, SALLA_CONTRACT, ZID_CONTRACT];
