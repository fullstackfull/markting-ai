import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeConnector, type RawSource } from '@/lib/markting/commerce/providers';
import { COMMERCE_CAPABILITIES, PROVIDER_SEMANTIC_NOTES } from '@/lib/markting/commerce/connector';
import { runIncrementalSync, backfillWindow, MAX_PAGES_PER_RUN, type SyncStore, type SyncCheckpoint } from '@/lib/markting/commerce/sync';
import { ingestWebhook, verifySignature, type WebhookPorts } from '@/lib/markting/commerce/webhooks';
import { productStats, topByProfit, highRefund, inventoryRisk, partitionByPromotion, creativeCommerceLinks } from '@/lib/markting/commerce/products';
import { generateCommerceRecommendations, diagnoseCommerce } from '@/lib/markting/commerce/diagnostics';
import { CostBook } from '@/lib/markting/commerce/profit';
import type { Order } from '@/lib/markting/commerce/model';

// ---- a fixture RawSource (the seam a live HTTP client fills) ----
function source(rows: Record<string, unknown[]>): RawSource {
  return {
    async stores() { return rows.stores ?? [{ id: 's1', name: 'Store', currency: 'SAR' }]; },
    async orders(_c, _w, cursor) { return cursor === 'p2' ? { rows: [] } : { rows: rows.orders ?? [], nextCursor: undefined }; },
    async products() { return { rows: rows.products ?? [] }; },
    async refunds() { return rows.refunds ?? []; },
  };
}

describe('commerce connectors (5C–5G) normalize into the canonical model', () => {
  it('Salla: tax-inclusive totals read the tax line explicitly', async () => {
    const c = makeConnector('salla', source({ orders: [{ id: 'o1', store_id: 's1', currency: 'SAR', status: 'completed', paid_at: '2026-09-10', sub_total: 9000, tax: 1000, shipping_cost: 500, discount: 0, total: 10500, items: [{ id: 'i1', product_id: 'p1', name: 'x', quantity: 2, price: 4500 }] }] }));
    const { orders } = await c.listOrders({ connectionId: 'conn', window: { start: '2026-09-01', end: '2026-09-30' } });
    expect(orders[0]!.taxTotal!.minorUnits).toBe(1000);
    expect(orders[0]!.grossTotal.minorUnits).toBe(10500);
    expect(orders[0]!.stage).toBe('fulfilled');
    expect(orders[0]!.platform).toBe('salla');
  });
  it('Shopify: financial_status + fulfillment_status are independent', async () => {
    const c = makeConnector('shopify', source({ orders: [{ id: '55', store_id: 's1', currency: 'USD', financial_status: 'paid', fulfillment_status: null, subtotal_price: '90.00', total_tax: '5.00', total_discounts: '0.00', current_total_price: '95.00', processed_at: '2026-09-10', line_items: [{ id: 'li', product_id: 'p', variant_id: 'v', title: 't', quantity: 1, price: '90.00' }], refunds: [] }] }));
    const { orders } = await c.listOrders({ connectionId: 'conn', window: { start: '2026-09-01', end: '2026-09-30' } });
    expect(orders[0]!.paymentStatus).toBe('paid');
    expect(orders[0]!.fulfillmentStatus).toBe('unfulfilled'); // paid but unfulfilled
    expect(orders[0]!.grossTotal.minorUnits).toBe(9500);
  });
  it('WooCommerce: refunds are negative-line records; unknown meta stays in raw', async () => {
    const c = makeConnector('woocommerce', source({ orders: [{ id: '7', store_id: 's1', currency: 'USD', status: 'completed', date_paid: '2026-09-10', total: '100.00', total_tax: '0.00', shipping_total: '0.00', discount_total: '0.00', line_items: [{ id: 'l', product_id: 'p', name: 'n', quantity: 1, price: '100.00' }], refunds: [{ total: '-25.00' }], meta_data: [{ key: '_wc_order_attribution_utm_source', value: 'google' }, { key: 'random_plugin_field', value: 'x' }] }] }));
    const { orders } = await c.listOrders({ connectionId: 'conn', window: { start: '2026-09-01', end: '2026-09-30' } });
    expect(orders[0]!.refundedTotal!.minorUnits).toBe(2500);
    expect(orders[0]!.acquisition!.utmSource).toBe('google');
    expect((orders[0]!.raw!.meta_data as unknown[]).length).toBe(2); // unknown meta preserved, not trusted
  });
  it('Zid: distinct status mapping (not reused from Salla)', async () => {
    const c = makeConnector('zid', source({ orders: [{ id: 'z1', store_id: 's1', currency: 'SAR', order_status: 'delivered', is_paid: true, order_total: 20000, tax: 0, shipping: 0, products: [{ id: 'p', name: 'n', quantity: 1, price: 20000 }] }] }));
    const { orders } = await c.listOrders({ connectionId: 'conn', window: { start: '2026-09-01', end: '2026-09-30' } });
    expect(orders[0]!.stage).toBe('fulfilled');
    expect(orders[0]!.paymentStatus).toBe('paid');
  });
  it('Generic: missing required fields are rejected (no arbitrary JSON into business truth)', async () => {
    const c = makeConnector('custom', source({ orders: [{ external_store_id: 's1' }] })); // missing order id/currency/created_at
    await expect(c.listOrders({ connectionId: 'conn', window: { start: '2026-09-01', end: '2026-09-30' } })).rejects.toThrow(/required fields/);
  });
  it('capability matrix + semantic notes exist for every platform', () => {
    for (const p of ['salla', 'zid', 'shopify', 'woocommerce', 'custom'] as const) {
      expect(COMMERCE_CAPABILITIES[p]).toBeTruthy();
      expect(PROVIDER_SEMANTIC_NOTES[p].length).toBeGreaterThan(0);
    }
    expect(COMMERCE_CAPABILITIES.custom.refunds).toBe(false);
  });
  it('healthCheck classifies FIXTURE_PROVEN (no live creds)', async () => {
    const h = await makeConnector('salla', source({})).healthCheck({ connectionId: 'c' });
    expect(h.classification).toBe('FIXTURE_PROVEN');
  });
});

describe('sync engine (5H): incremental, idempotent, checkpointed, dead-lettered', () => {
  function memStore(): SyncStore & { cp?: SyncCheckpoint; dead: string[]; upserts: number } {
    const s: SyncStore & { cp?: SyncCheckpoint; dead: string[]; upserts: number } = {
      cp: undefined, dead: [], upserts: 0,
      async getCheckpoint() { return s.cp ?? null; },
      async saveCheckpoint(cp) { s.cp = cp; },
      async upsertOrders(_o, orders) { s.upserts += orders.length; return orders.length; },
      async deadLetter(dl) { s.dead.push(dl.detail); },
    };
    return s;
  }
  it('ingests, advances the high-water checkpoint, and stamps org', async () => {
    const connector = makeConnector('salla', source({ orders: [{ id: 'o1', store_id: 's1', currency: 'SAR', status: 'paid', paid_at: '2026-09-10', sub_total: 10000, total: 10000, items: [] }] }));
    const store = memStore();
    const res = await runIncrementalSync({ connector, store, connectionId: 'conn', organizationId: 'orgA', now: Date.parse('2026-09-30') });
    expect(res.status).toBe('completed');
    expect(res.ordersIngested).toBe(1);
    expect(store.cp!.highWater).toBeTruthy();
    expect(store.cp!.status).toBe('idle');
  });
  it('dead-letters and preserves the checkpoint on connector error (retry-safe)', async () => {
    const connector = makeConnector('salla', { stores: async () => [], orders: async () => { throw new Error('rate limited'); }, products: async () => ({ rows: [] }), refunds: async () => [] });
    const store = memStore();
    const res = await runIncrementalSync({ connector, store, connectionId: 'conn', organizationId: 'orgA' });
    expect(res.status).toBe('error');
    expect(store.dead[0]).toMatch(/rate limited/);
    expect(store.cp!.consecutiveErrors).toBe(1);
  });
  it('backfillWindow is bounded', () => {
    expect(() => backfillWindow('2020-01-01', '2026-01-01')).toThrow(/bounded/);
    expect(backfillWindow('2026-01-01', '2026-02-01').start).toBe('2026-01-01');
  });
  it('MAX_PAGES_PER_RUN bounds a run', () => { expect(MAX_PAGES_PER_RUN).toBeGreaterThan(0); });
});

describe('webhooks (5I): signature, dedup, replay, connection-mapped org', () => {
  const secret = 'shhh';
  function env(over: Partial<Parameters<typeof ingestWebhook>[0]> = {}) {
    const rawBody = JSON.stringify({ topic: 'orders/create', store_id: 'ATTACKER_STORE', organization_id: 'org-EVIL' });
    const signature = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    return { connectionId: 'conn', platform: 'shopify' as const, externalEventId: 'evt1', topic: 'orders/create', signature, timestamp: new Date().toISOString(), rawBody, ...over };
  }
  function ports(seenSet = new Set<string>()): WebhookPorts {
    return {
      async resolveConnection(id) { return id === 'conn' ? { organizationId: 'org-REAL', signingSecret: secret } : null; },
      async seen(_c, id) { return seenSet.has(id); },
      async record(_c, id) { seenSet.add(id); },
    };
  }
  it('accepts a valid signature and uses the SERVER-resolved org (never payload org)', async () => {
    const r = await ingestWebhook(env(), ports());
    expect(r.accepted).toBe(true);
    expect(r.organizationId).toBe('org-REAL'); // NOT org-EVIL from the payload
  });
  it('rejects a bad signature', async () => {
    const r = await ingestWebhook(env({ signature: 'AAAA' }), ports());
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('INVALID_SIGNATURE');
  });
  it('rejects a replay (stale timestamp)', async () => {
    const r = await ingestWebhook(env({ timestamp: new Date(Date.now() - 3_600_000).toISOString() }), ports());
    expect(r.reason).toBe('REPLAY');
  });
  it('dedupes a duplicate event', async () => {
    const seen = new Set<string>();
    expect((await ingestWebhook(env(), ports(seen))).accepted).toBe(true);
    expect((await ingestWebhook(env(), ports(seen))).reason).toBe('DUPLICATE');
  });
  it('rejects an unknown connection', async () => {
    const r = await ingestWebhook(env({ connectionId: 'ghost' }), ports());
    expect(r.reason).toBe('UNKNOWN_CONNECTION');
  });
  it('verifySignature is timing-safe + length-checked', () => {
    expect(verifySignature('a', 'AAAA', 'k')).toBe(false);
  });
});

describe('product/SKU intelligence + review-only recommendations', () => {
  const SAR = (m: number) => ({ minorUnits: m, currency: 'SAR' });
  function o(id: string, sku: string, price: number, qty = 1, refunded = 0): Order {
    return { orderId: id, organizationId: 'o', storeId: 'salla:s1', platform: 'salla', externalOrderId: id, createdAt: '2026-09-10', currency: 'SAR', subtotal: SAR(price * qty), grossTotal: SAR(price * qty), refundedTotal: SAR(refunded), stage: 'paid', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled', lines: [{ lineId: 'l', sku, title: sku, quantity: qty, unitPrice: SAR(price) }], provenance: { platform: 'salla', sourceId: id, origin: 'connector_read', tiers: [] } };
  }
  it('aggregates per-SKU revenue, refund rate, and profit only when COGS known', () => {
    const book = new CostBook([{ sku: 'A', unitCost: SAR(4000), provenance: { platform: 'salla', sourceId: 'A', origin: 'merchant_config', tiers: ['COST_CONFIGURED'] } }]);
    const stats = productStats([o('1', 'A', 10000), o('2', 'B', 5000, 1, 2000)], [], book);
    const a = stats.find((s) => s.sku === 'A')!; const b = stats.find((s) => s.sku === 'B')!;
    expect(a.grossProfitMinor).toBe(6000);      // 10000 - 0 refund - 4000 cogs
    expect(b.grossProfitMinor).toBeUndefined(); // no cost for B
    expect(b.refundRate).toBeCloseTo(0.4, 2);
    expect(topByProfit(stats)[0]!.sku).toBe('A');
    expect(highRefund(stats, 0.3)[0]!.sku).toBe('B');
  });
  it('inventory risk is advisory only (never pauses ads)', () => {
    const flags = inventoryRisk([{ sku: 'A', onHand: 3 }, { sku: 'B', onHand: 50 }]);
    expect(flags.find((f) => f.sku === 'A')!.state).toBe('LOW_INVENTORY_RISK');
    expect(flags.find((f) => f.sku === 'B')!.state).toBe('OK');
  });
  it('promotion partitioning keeps sale lift out of baseline', () => {
    const promos = [{ id: 'p', label: 'sale', start: '2026-09-01', end: '2026-09-15' }];
    const { promo, baseline } = partitionByPromotion([o('1', 'A', 10000), { ...o('2', 'A', 10000), createdAt: '2026-09-20' }], promos);
    expect(promo).toHaveLength(1);
    expect(baseline).toHaveLength(1);
  });
  it('creative×commerce profit is withheld when attribution is weak', () => {
    const links = creativeCommerceLinks({ orders: [o('1', 'A', 10000)], creativeOf: () => ({ ref: 'cr1', directlyTagged: false }) });
    expect(links[0]!.attributionTrusted).toBe(false);
    expect(links[0]!.profitMinor).toBeUndefined();
    expect(links[0]!.caveat).toMatch(/attribution too weak/);
  });
  it('recommendations are review-only (no endpoint/body, human approval always)', () => {
    const diagnoses = diagnoseCommerce({ current: { refunds: { refundRateByCount: 0.3, refundRateByValue: 0.25, fullRefunds: 1, partialRefunds: 2, mixedCurrency: false } }, dataGaps: ['product COGS'] });
    const recs = generateCommerceRecommendations({ organizationId: 'o', diagnoses });
    expect(recs.every((r) => r.requiresHumanApproval === true)).toBe(true);
    const json = JSON.stringify(recs).toLowerCase();
    for (const forbidden of ['endpoint', 'publish', 'mutation', 'budget', 'pause']) expect(json).not.toContain(`"${forbidden}"`);
    expect(recs.some((r) => r.category === 'REFUND_RATE_REVIEW')).toBe(true);
  });
});
