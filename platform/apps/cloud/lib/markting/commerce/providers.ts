/**
 * Phase 5C–5G — read-only provider connectors for Salla, Zid, Shopify, WooCommerce and a generic
 * custom API. Each maps provider-shaped payloads into the SAME canonical model and NEVER writes.
 *
 * No live commerce credentials exist in this environment, so connectors are driven by an injectable
 * `RawSource` (the seam a live HTTP client would fill later) and are classified FIXTURE_PROVEN. The
 * normalizers encode the documented per-provider semantic differences (Salla/Zid tax-inclusive totals,
 * Shopify discrete financial/fulfillment status, WooCommerce negative-line refunds + arbitrary meta)
 * so one platform's semantics are never assumed to equal another's.
 */
import {
  type CommerceConnector, type ConnectorCapabilities, type HealthResult, type ListOrdersResult, type SyncWindow,
  COMMERCE_CAPABILITIES,
} from './connector';
import {
  type CommercePlatform, type Order, type OrderLine, type Product, type Refund, type Store,
  type PaymentStatus, type FulfillmentStatus, type OrderStage, type Provenance,
  orderId, productId, storeId,
} from './model';
import { orderTrustTiers } from './trust';

/** The seam a live API client fills. Returns already-authenticated, tenant-scoped raw payloads. */
export interface RawSource {
  stores(connectionId: string): Promise<unknown[]>;
  orders(connectionId: string, window: SyncWindow, cursor?: string): Promise<{ rows: unknown[]; nextCursor?: string }>;
  products(connectionId: string, cursor?: string): Promise<{ rows: unknown[]; nextCursor?: string }>;
  refunds(connectionId: string, window: SyncWindow): Promise<unknown[]>;
}

function prov(platform: CommercePlatform, sourceId: string, order: Order): Provenance {
  return { platform, sourceId, origin: 'connector_read', observedAt: new Date(0).toISOString(), tiers: orderTrustTiers(order) };
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Base connector: common plumbing; each platform supplies normalizers. */
abstract class BaseConnector implements CommerceConnector {
  abstract readonly platform: CommercePlatform;
  constructor(protected source: RawSource) {}
  capabilities(): ConnectorCapabilities { return COMMERCE_CAPABILITIES[this.platform]; }
  async healthCheck({ connectionId }: { connectionId: string }): Promise<HealthResult> {
    try {
      await this.source.stores(connectionId);
      return { ok: true, platform: this.platform, classification: 'FIXTURE_PROVEN', detail: 'fixture source reachable; live transport BLOCKED_EXTERNAL (no credentials)' };
    } catch (e) {
      return { ok: false, platform: this.platform, classification: 'BLOCKED_EXTERNAL', detail: String((e as Error).message ?? e) };
    }
  }
  async listStores({ connectionId }: { connectionId: string }): Promise<Store[]> {
    const rows = await this.source.stores(connectionId);
    return rows.map((r) => this.normStore(r as Raw, connectionId));
  }
  async listOrders({ connectionId, window, cursor }: { connectionId: string; window: SyncWindow; cursor?: string; limit?: number }): Promise<ListOrdersResult> {
    const { rows, nextCursor } = await this.source.orders(connectionId, window, cursor);
    return { orders: rows.map((r) => this.normOrder(r as Raw, connectionId)), nextCursor };
  }
  async getOrder({ connectionId, externalOrderId }: { connectionId: string; externalOrderId: string }): Promise<Order | null> {
    const { orders } = await this.listOrders({ connectionId, window: { start: '1970-01-01', end: '2999-01-01' } });
    return orders.find((o) => o.externalOrderId === externalOrderId) ?? null;
  }
  async listProducts({ connectionId, cursor }: { connectionId: string; cursor?: string }): Promise<{ products: Product[]; nextCursor?: string }> {
    const { rows, nextCursor } = await this.source.products(connectionId, cursor);
    return { products: rows.map((r) => this.normProduct(r as Raw)), nextCursor };
  }
  async listRefunds({ connectionId, window }: { connectionId: string; window: SyncWindow }): Promise<Refund[]> {
    const rows = await this.source.refunds(connectionId, window);
    return rows.map((r) => this.normRefund(r as Raw));
  }
  // Each platform overrides these.
  protected abstract normStore(r: Raw, connectionId: string): Store;
  protected abstract normOrder(r: Raw, connectionId: string): Order;
  protected abstract normProduct(r: Raw): Product;
  protected abstract normRefund(r: Raw): Refund;

  // Shared helpers for building canonical orders from already-mapped primitives.
  protected buildOrder(args: {
    connectionId: string; externalStoreId: string; externalOrderId: string; orderNumber?: string;
    createdAt: string; paidAt?: string; fulfilledAt?: string; cancelledAt?: string; currency: string;
    subtotalMinor: number; discountMinor?: number; taxMinor?: number; shippingMinor?: number; grossMinor: number; refundedMinor?: number;
    stage: OrderStage; payment: PaymentStatus; fulfillment: FulfillmentStatus;
    lines: OrderLine[]; acquisition?: Order['acquisition']; customer?: Order['customer']; raw: Raw;
  }): Order {
    const cur = args.currency;
    const o: Order = {
      orderId: orderId(this.platform, args.externalStoreId, args.externalOrderId),
      organizationId: '', // set by the store on persist; analysis builds use the connection's org
      storeId: storeId(this.platform, args.externalStoreId),
      platform: this.platform,
      externalOrderId: args.externalOrderId,
      orderNumber: args.orderNumber,
      createdAt: args.createdAt, paidAt: args.paidAt, fulfilledAt: args.fulfilledAt, cancelledAt: args.cancelledAt,
      currency: cur,
      subtotal: { minorUnits: args.subtotalMinor, currency: cur },
      discountTotal: args.discountMinor != null ? { minorUnits: args.discountMinor, currency: cur } : undefined,
      taxTotal: args.taxMinor != null ? { minorUnits: args.taxMinor, currency: cur } : undefined,
      shippingTotal: args.shippingMinor != null ? { minorUnits: args.shippingMinor, currency: cur } : undefined,
      grossTotal: { minorUnits: args.grossMinor, currency: cur },
      refundedTotal: args.refundedMinor != null ? { minorUnits: args.refundedMinor, currency: cur } : undefined,
      stage: args.stage, paymentStatus: args.payment, fulfillmentStatus: args.fulfillment,
      customer: args.customer, acquisition: args.acquisition, lines: args.lines,
      provenance: { platform: this.platform, sourceId: args.externalOrderId, origin: 'connector_read', tiers: [] },
      raw: args.raw,
    };
    o.provenance = prov(this.platform, args.externalOrderId, o);
    return o;
  }
}

// ---- Salla (5C) ----
class SallaConnector extends BaseConnector {
  readonly platform = 'salla' as const;
  protected normStore(r: Raw, _c: string): Store {
    return { storeId: storeId('salla', str(r.id) ?? '0'), organizationId: '', platform: 'salla', externalStoreId: str(r.id) ?? '0', name: str(r.name), currency: str(r.currency), timezone: str(r.timezone), raw: r };
  }
  protected normOrder(r: Raw, connectionId: string): Order {
    // Salla totals are typically TAX-INCLUSIVE; read the tax line explicitly.
    const currency = str(r.currency) ?? 'SAR';
    const items = (r.items as Raw[] | undefined) ?? [];
    const lines: OrderLine[] = items.map((it, i) => ({
      lineId: str(it.id) ?? `l${i}`, productId: it.product_id != null ? productId('salla', String(it.product_id)) : undefined, sku: str(it.sku),
      title: str(it.name) ?? 'item', quantity: num(it.quantity) || 1,
      unitPrice: { minorUnits: num(it.price), currency }, discountAllocated: { minorUnits: num(it.discount), currency },
      raw: it,
    }));
    const status = str(r.status) ?? 'placed';
    const payment: PaymentStatus = r.paid_at ? 'paid' : status === 'cancelled' ? 'voided' : 'pending';
    // Salla totals are TAX-INCLUSIVE. Derive a tax/shipping-EXCLUSIVE merchandise subtotal from the
    // total (like Zid) so the excl-tax revenue basis is honest regardless of whether sub_total carried
    // tax. Falls back to sub_total only if total is absent.
    const tax = num(r.tax), shipping = num(r.shipping_cost), total = num(r.total);
    const subtotalExclTax = total ? total - tax - shipping : num(r.sub_total);
    return this.buildOrder({
      connectionId, externalStoreId: str(r.store_id) ?? '0', externalOrderId: str(r.id) ?? '0', orderNumber: str(r.reference_id),
      createdAt: str(r.created_at) ?? new Date(0).toISOString(), paidAt: str(r.paid_at), fulfilledAt: str(r.shipped_at), cancelledAt: status === 'cancelled' ? str(r.updated_at) : undefined,
      currency, subtotalMinor: subtotalExclTax, discountMinor: num(r.discount), taxMinor: tax, shippingMinor: shipping,
      grossMinor: num(r.total), refundedMinor: num(r.refunded),
      stage: mapStage(status), payment, fulfillment: r.shipped_at ? 'fulfilled' : 'unfulfilled', lines, raw: r,
    });
  }
  protected normProduct(r: Raw): Product {
    return { productId: productId('salla', str(r.id) ?? '0'), platform: 'salla', externalProductId: str(r.id) ?? '0', sku: str(r.sku), title: str(r.name) ?? 'product', raw: r };
  }
  protected normRefund(r: Raw): Refund {
    const currency = str(r.currency) ?? 'SAR';
    return { refundId: `salla:${str(r.id)}`, orderId: orderId('salla', str(r.store_id) ?? '0', str(r.order_id) ?? '0'), organizationId: '', storeId: storeId('salla', str(r.store_id) ?? '0'), platform: 'salla', externalRefundId: str(r.id) ?? '0', amount: { minorUnits: num(r.amount), currency }, kind: num(r.amount) >= num(r.order_total) ? 'full' : 'partial', refundedAt: str(r.created_at) ?? new Date(0).toISOString(), reason: str(r.reason), provenance: { platform: 'salla', sourceId: str(r.id) ?? '0', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] }, raw: r };
  }
}

// ---- Zid (5D) — distinct status semantics from Salla ----
class ZidConnector extends BaseConnector {
  readonly platform = 'zid' as const;
  protected normStore(r: Raw, _c: string): Store {
    return { storeId: storeId('zid', str(r.id) ?? '0'), organizationId: '', platform: 'zid', externalStoreId: str(r.id) ?? '0', name: str(r.name), currency: str(r.currency), timezone: str(r.timezone), raw: r };
  }
  protected normOrder(r: Raw, connectionId: string): Order {
    const currency = str(r.currency) ?? 'SAR';
    const items = (r.products as Raw[] | undefined) ?? [];
    const lines: OrderLine[] = items.map((it, i) => ({
      lineId: str(it.id) ?? `l${i}`, productId: it.product_id != null ? productId('zid', String(it.product_id)) : undefined, sku: str(it.sku),
      title: str(it.name) ?? 'item', quantity: num(it.quantity) || 1, unitPrice: { minorUnits: num(it.price), currency }, raw: it,
    }));
    // Zid uses its own order_status codes — mapped independently, NOT reused from Salla.
    const zStatus = str(r.order_status) ?? 'new';
    return this.buildOrder({
      connectionId, externalStoreId: str(r.store_id) ?? '0', externalOrderId: str(r.id) ?? '0', orderNumber: str(r.code),
      createdAt: str(r.created_at) ?? new Date(0).toISOString(), paidAt: r.is_paid ? str(r.created_at) : undefined, fulfilledAt: str(r.delivered_at),
      currency, subtotalMinor: num(r.order_total) - num(r.tax) - num(r.shipping), taxMinor: num(r.tax), shippingMinor: num(r.shipping),
      grossMinor: num(r.order_total), refundedMinor: num(r.refunded_amount),
      stage: mapZidStage(zStatus), payment: r.is_paid ? 'paid' : 'pending', fulfillment: r.delivered_at ? 'fulfilled' : 'unfulfilled', lines, raw: r,
    });
  }
  protected normProduct(r: Raw): Product {
    return { productId: productId('zid', str(r.id) ?? '0'), platform: 'zid', externalProductId: str(r.id) ?? '0', sku: str(r.sku), title: str(r.name) ?? 'product', raw: r };
  }
  protected normRefund(r: Raw): Refund {
    const currency = str(r.currency) ?? 'SAR';
    return { refundId: `zid:${str(r.id)}`, orderId: orderId('zid', str(r.store_id) ?? '0', str(r.order_id) ?? '0'), organizationId: '', storeId: storeId('zid', str(r.store_id) ?? '0'), platform: 'zid', externalRefundId: str(r.id) ?? '0', amount: { minorUnits: num(r.amount), currency }, kind: str(r.type) === 'full' ? 'full' : 'partial', refundedAt: str(r.created_at) ?? new Date(0).toISOString(), reason: str(r.reason), provenance: { platform: 'zid', sourceId: str(r.id) ?? '0', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] }, raw: r };
  }
}

// ---- Shopify (5E) — discrete financial/fulfillment status ----
class ShopifyConnector extends BaseConnector {
  readonly platform = 'shopify' as const;
  protected normStore(r: Raw, _c: string): Store {
    return { storeId: storeId('shopify', str(r.id) ?? '0'), organizationId: '', platform: 'shopify', externalStoreId: str(r.id) ?? '0', name: str(r.name), currency: str(r.currency), timezone: str(r.iana_timezone), raw: r };
  }
  protected normOrder(r: Raw, connectionId: string): Order {
    const currency = str(r.currency) ?? 'USD';
    const items = (r.line_items as Raw[] | undefined) ?? [];
    const lines: OrderLine[] = items.map((it, i) => ({
      lineId: str(it.id) ?? `l${i}`, productId: it.product_id != null ? productId('shopify', String(it.product_id)) : undefined, variantId: it.variant_id != null ? productId('shopify', String(it.variant_id)) : undefined, sku: str(it.sku),
      title: str(it.title) ?? 'item', quantity: num(it.quantity) || 1,
      unitPrice: { minorUnits: Math.round(parseFloat(str(it.price) ?? '0') * 100), currency }, raw: it,
    }));
    const fin = str(r.financial_status) ?? 'pending';
    const ful = str(r.fulfillment_status) ?? undefined; // independent of financial_status
    const toMinor = (v: unknown): number => Math.round(parseFloat(str(v) ?? '0') * 100);
    const acq = (r.note_attributes as Raw[] | undefined);
    return this.buildOrder({
      connectionId, externalStoreId: str(r.store_id) ?? '0', externalOrderId: str(r.id) ?? '0', orderNumber: str(r.name),
      createdAt: str(r.created_at) ?? new Date(0).toISOString(), paidAt: fin === 'paid' || fin === 'partially_refunded' || fin === 'refunded' ? str(r.processed_at) : undefined, fulfilledAt: ful === 'fulfilled' ? str(r.updated_at) : undefined, cancelledAt: str(r.cancelled_at),
      currency, subtotalMinor: toMinor(r.subtotal_price), discountMinor: toMinor(r.total_discounts), taxMinor: toMinor(r.total_tax), shippingMinor: toMinor((r.total_shipping_price_set as Raw | undefined)?.shop_money as Raw | undefined ? ((r.total_shipping_price_set as Raw).shop_money as Raw).amount : 0),
      grossMinor: toMinor(r.current_total_price ?? r.total_price), refundedMinor: toMinor((r.refunds as Raw[] | undefined)?.reduce?.((a, rf) => a + parseFloat(str((rf as Raw).amount) ?? '0'), 0) ?? 0),
      stage: mapShopifyStage(fin, str(r.cancelled_at)), payment: mapShopifyPayment(fin), fulfillment: (ful as FulfillmentStatus) ?? 'unfulfilled',
      lines, raw: r,
      acquisition: shopifyAcquisition(r, acq),
    });
  }
  protected normProduct(r: Raw): Product {
    const variants = (r.variants as Raw[] | undefined)?.map((v, i) => ({ variantId: productId('shopify', String(v.id ?? i)), productId: productId('shopify', str(r.id) ?? '0'), sku: str(v.sku), title: str(v.title), raw: v }));
    return { productId: productId('shopify', str(r.id) ?? '0'), platform: 'shopify', externalProductId: str(r.id) ?? '0', title: str(r.title) ?? 'product', variants, raw: r };
  }
  protected normRefund(r: Raw): Refund {
    const currency = str(r.currency) ?? 'USD';
    const amt = Math.round(parseFloat(str(r.amount) ?? '0') * 100);
    return { refundId: `shopify:${str(r.id)}`, orderId: orderId('shopify', str(r.store_id) ?? '0', str(r.order_id) ?? '0'), organizationId: '', storeId: storeId('shopify', str(r.store_id) ?? '0'), platform: 'shopify', externalRefundId: str(r.id) ?? '0', amount: { minorUnits: amt, currency }, kind: r.restock ? 'full' : 'partial', refundedAt: str(r.created_at) ?? new Date(0).toISOString(), reason: str(r.note), provenance: { platform: 'shopify', sourceId: str(r.id) ?? '0', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] }, raw: r };
  }
  listProductCosts = async ({ connectionId }: { connectionId: string }) => {
    // Shopify may expose InventoryItem.cost where the merchant populated it (merchant-config trust).
    const { products } = await this.listProducts({ connectionId });
    const out: Array<{ productId: string; sku?: string; unitCost: { minorUnits: number; currency: string } }> = [];
    for (const p of products) {
      const cost = (p.raw?.variants as Raw[] | undefined)?.[0]?.cost;
      if (cost != null) out.push({ productId: p.productId, sku: p.sku, unitCost: { minorUnits: Math.round(parseFloat(String(cost)) * 100), currency: (p.raw?.currency as string) ?? 'USD' } });
    }
    return out;
  };
}

// ---- WooCommerce (5F) — negative-line refunds, arbitrary meta ----
class WooConnector extends BaseConnector {
  readonly platform = 'woocommerce' as const;
  protected normStore(r: Raw, _c: string): Store {
    return { storeId: storeId('woocommerce', str(r.id) ?? '0'), organizationId: '', platform: 'woocommerce', externalStoreId: str(r.id) ?? '0', name: str(r.name), currency: str(r.currency), raw: r };
  }
  protected normOrder(r: Raw, connectionId: string): Order {
    const currency = str(r.currency) ?? 'USD';
    const items = (r.line_items as Raw[] | undefined) ?? [];
    const toMinor = (v: unknown): number => Math.round(parseFloat(str(v) ?? '0') * 100);
    const lines: OrderLine[] = items.map((it, i) => ({
      lineId: str(it.id) ?? `l${i}`, productId: it.product_id != null ? productId('woocommerce', String(it.product_id)) : undefined, sku: str(it.sku),
      title: str(it.name) ?? 'item', quantity: num(it.quantity) || 1, unitPrice: { minorUnits: toMinor(it.price), currency }, raw: it,
    }));
    // Unknown meta fields stay in raw — never promoted to trusted canonical facts.
    const status = str(r.status) ?? 'pending';
    const refundsMinor = ((r.refunds as Raw[] | undefined) ?? []).reduce((a, rf) => a + Math.abs(toMinor((rf as Raw).total)), 0);
    return this.buildOrder({
      connectionId, externalStoreId: str(r.store_id) ?? '0', externalOrderId: str(r.id) ?? '0', orderNumber: str(r.number),
      createdAt: str(r.date_created) ?? new Date(0).toISOString(), paidAt: str(r.date_paid), cancelledAt: status === 'cancelled' ? str(r.date_modified) : undefined,
      currency, subtotalMinor: toMinor(r.total) - toMinor(r.total_tax) - toMinor(r.shipping_total), taxMinor: toMinor(r.total_tax), shippingMinor: toMinor(r.shipping_total), discountMinor: toMinor(r.discount_total),
      grossMinor: toMinor(r.total), refundedMinor: refundsMinor,
      stage: mapWooStage(status), payment: str(r.date_paid) ? 'paid' : status === 'failed' ? 'failed' : 'pending', fulfillment: status === 'completed' ? 'fulfilled' : 'unfulfilled',
      lines, raw: r, acquisition: wooAcquisition(r),
    });
  }
  protected normProduct(r: Raw): Product {
    return { productId: productId('woocommerce', str(r.id) ?? '0'), platform: 'woocommerce', externalProductId: str(r.id) ?? '0', sku: str(r.sku), title: str(r.name) ?? 'product', raw: r };
  }
  protected normRefund(r: Raw): Refund {
    const currency = str(r.currency) ?? 'USD';
    const amt = Math.abs(Math.round(parseFloat(str(r.total) ?? '0') * 100));
    return { refundId: `woocommerce:${str(r.id)}`, orderId: orderId('woocommerce', str(r.store_id) ?? '0', str(r.order_id) ?? '0'), organizationId: '', storeId: storeId('woocommerce', str(r.store_id) ?? '0'), platform: 'woocommerce', externalRefundId: str(r.id) ?? '0', amount: { minorUnits: amt, currency }, kind: 'partial', refundedAt: str(r.date_created) ?? new Date(0).toISOString(), reason: str(r.reason), provenance: { platform: 'woocommerce', sourceId: str(r.id) ?? '0', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] }, raw: r };
  }
}

// ---- Generic custom API (5G) — explicit validated schema only ----
class GenericConnector extends BaseConnector {
  readonly platform = 'custom' as const;
  protected normStore(r: Raw, _c: string): Store {
    return { storeId: storeId('custom', str(r.external_store_id) ?? '0'), organizationId: '', platform: 'custom', externalStoreId: str(r.external_store_id) ?? '0', name: str(r.name), currency: str(r.currency), raw: r };
  }
  protected normOrder(r: Raw, connectionId: string): Order {
    // The generic schema REQUIRES identity, currency and timestamps; arbitrary JSON is rejected upstream.
    const currency = str(r.currency);
    if (!currency || !str(r.external_order_id) || !str(r.created_at)) {
      throw new Error('generic commerce order missing required fields (external_order_id, currency, created_at)');
    }
    const items = (r.lines as Raw[] | undefined) ?? [];
    const lines: OrderLine[] = items.map((it, i) => ({ lineId: str(it.line_id) ?? `l${i}`, sku: str(it.sku), title: str(it.title) ?? 'item', quantity: num(it.quantity) || 1, unitPrice: { minorUnits: num(it.unit_price_minor), currency }, raw: it }));
    return this.buildOrder({
      connectionId, externalStoreId: str(r.external_store_id) ?? '0', externalOrderId: str(r.external_order_id)!, orderNumber: str(r.order_number),
      createdAt: str(r.created_at)!, paidAt: str(r.paid_at), currency, subtotalMinor: num(r.subtotal_minor), taxMinor: num(r.tax_minor), shippingMinor: num(r.shipping_minor), discountMinor: num(r.discount_minor),
      grossMinor: num(r.gross_minor), refundedMinor: num(r.refunded_minor),
      stage: (str(r.stage) as OrderStage) ?? 'placed', payment: (str(r.payment_status) as PaymentStatus) ?? 'unknown', fulfillment: (str(r.fulfillment_status) as FulfillmentStatus) ?? 'unknown', lines, raw: r,
    });
  }
  protected normProduct(r: Raw): Product {
    return { productId: productId('custom', str(r.external_product_id) ?? '0'), platform: 'custom', externalProductId: str(r.external_product_id) ?? '0', sku: str(r.sku), title: str(r.title) ?? 'product', raw: r };
  }
  protected normRefund(r: Raw): Refund {
    const currency = str(r.currency) ?? 'USD';
    return { refundId: `custom:${str(r.external_refund_id)}`, orderId: orderId('custom', str(r.external_store_id) ?? '0', str(r.external_order_id) ?? '0'), organizationId: '', storeId: storeId('custom', str(r.external_store_id) ?? '0'), platform: 'custom', externalRefundId: str(r.external_refund_id) ?? '0', amount: { minorUnits: num(r.amount_minor), currency }, kind: r.full ? 'full' : 'partial', refundedAt: str(r.refunded_at) ?? new Date(0).toISOString(), provenance: { platform: 'custom', sourceId: str(r.external_refund_id) ?? '0', origin: 'connector_read', tiers: ['REFUND_VERIFIED'] }, raw: r };
  }
}

// ---- status mappers (per-platform; never shared across platforms) ----
function mapStage(s: string): OrderStage {
  switch (s) { case 'completed': case 'delivered': return 'fulfilled'; case 'cancelled': return 'cancelled'; case 'refunded': return 'refunded'; case 'paid': return 'paid'; default: return 'placed'; }
}
function mapZidStage(s: string): OrderStage {
  switch (s) { case 'delivered': case 'ready': return 'fulfilled'; case 'cancelled': return 'cancelled'; case 'refunded': return 'refunded'; case 'paid': case 'preparing': return 'paid'; default: return 'placed'; }
}
function mapShopifyStage(fin: string, cancelledAt?: string): OrderStage {
  if (cancelledAt) return 'cancelled';
  switch (fin) { case 'paid': return 'paid'; case 'refunded': return 'refunded'; case 'partially_refunded': return 'partially_refunded'; case 'voided': return 'failed'; default: return 'placed'; }
}
function mapShopifyPayment(fin: string): PaymentStatus {
  switch (fin) { case 'paid': return 'paid'; case 'partially_refunded': return 'partially_refunded'; case 'refunded': return 'refunded'; case 'voided': return 'voided'; case 'pending': case 'authorized': return fin as PaymentStatus; default: return 'unknown'; }
}
function mapWooStage(s: string): OrderStage {
  switch (s) { case 'completed': return 'fulfilled'; case 'processing': case 'on-hold': return 'paid'; case 'cancelled': return 'cancelled'; case 'refunded': return 'refunded'; case 'failed': return 'failed'; default: return 'placed'; }
}
function shopifyAcquisition(r: Raw, notes?: Raw[]): Order['acquisition'] {
  const utm = (r.landing_site as string | undefined) ?? '';
  const ref = r.referring_site as string | undefined;
  const source = (r.source_name as string | undefined);
  if (!utm && !ref && !source && !notes?.length) return undefined;
  return { utmSource: source, landingPage: utm || undefined, referrer: ref, anonymous: !source && !utm };
}
function wooAcquisition(r: Raw): Order['acquisition'] {
  const meta = (r.meta_data as Raw[] | undefined) ?? [];
  const get = (k: string) => (meta.find((m) => (m as Raw).key === k) as Raw | undefined)?.value as string | undefined;
  const utmSource = get('_wc_order_attribution_utm_source');
  if (!utmSource) return undefined;
  return { utmSource, utmMedium: get('_wc_order_attribution_utm_medium'), utmCampaign: get('_wc_order_attribution_utm_campaign'), referrer: get('_wc_order_attribution_referrer'), anonymous: false };
}

export function makeConnector(platform: CommercePlatform, source: RawSource): CommerceConnector {
  switch (platform) {
    case 'salla': return new SallaConnector(source);
    case 'zid': return new ZidConnector(source);
    case 'shopify': return new ShopifyConnector(source);
    case 'woocommerce': return new WooConnector(source);
    case 'custom': return new GenericConnector(source);
  }
}

export { SallaConnector, ZidConnector, ShopifyConnector, WooConnector, GenericConnector };
