/**
 * Phase 5B — the ONE commerce connector contract. Every provider (Salla, Zid, Shopify, WooCommerce,
 * and a documented generic API) maps into this single contract and returns CANONICAL entities. There
 * is no per-provider domain model: provider-specific fields live in each entity's `raw` bag.
 *
 * Every method is READ-ONLY and tenant-scoped (the caller supplies an authenticated connection whose
 * org is server-derived). No method writes to the store. Connectors MUST NOT derive revenue from
 * ad-platform conversion value — they report merchant truth only.
 */
import type {
  CommercePlatform, Order, Product, Refund, Store, CommerceMoney,
} from './model';

export interface SyncWindow { start: string; end: string }

export interface ConnectorCapabilities {
  orders: boolean;
  refunds: boolean;
  products: boolean;
  /** Whether the platform exposes a trustworthy per-product cost field (rare; usually merchant-config). */
  cogs: boolean;
  /** Whether orders carry acquisition metadata (UTM/clickIds). */
  acquisitionRef: boolean;
  /** Whether new-vs-returning customer identity is reliably available. */
  customerIdentity: boolean;
  inventory: boolean;
  webhooks: boolean;
  incrementalCursor: boolean;
}

export interface HealthResult {
  ok: boolean;
  platform: CommercePlatform;
  classification: 'RUNTIME_PROVEN' | 'SANDBOX_PROVEN' | 'FIXTURE_PROVEN' | 'BLOCKED_EXTERNAL';
  detail: string;
}

export interface ListOrdersResult { orders: Order[]; nextCursor?: string }

/**
 * The unified read-only connector. Provider implementations normalize into canonical entities and
 * never issue a write. `connectionId` identifies the authenticated, tenant-scoped store connection.
 */
export interface CommerceConnector {
  readonly platform: CommercePlatform;
  capabilities(): ConnectorCapabilities;
  healthCheck(input: { connectionId: string }): Promise<HealthResult>;
  listStores(input: { connectionId: string }): Promise<Store[]>;
  listOrders(input: { connectionId: string; window: SyncWindow; cursor?: string; limit?: number }): Promise<ListOrdersResult>;
  getOrder(input: { connectionId: string; externalOrderId: string }): Promise<Order | null>;
  listProducts(input: { connectionId: string; cursor?: string }): Promise<{ products: Product[]; nextCursor?: string }>;
  listRefunds(input: { connectionId: string; window: SyncWindow }): Promise<Refund[]>;
  /** Optional inventory read (quantity on hand per variant/sku). Only where reliably available. */
  listInventory?(input: { connectionId: string }): Promise<Array<{ sku?: string; variantId?: string; onHand: number }>>;
  /** Optional per-product cost, ONLY if the platform supplies a trustworthy cost field. */
  listProductCosts?(input: { connectionId: string }): Promise<Array<{ productId: string; sku?: string; unitCost: CommerceMoney }>>;
}

/**
 * Per-platform capability map. Documented, conservative defaults (the connector reports its own at
 * runtime). COGS is false everywhere except where a platform genuinely exposes a cost field —
 * merchants normally configure cost out of band, so Phase 5 treats platform COGS as absent by default.
 */
export const COMMERCE_CAPABILITIES: Record<CommercePlatform, ConnectorCapabilities> = {
  salla: { orders: true, refunds: true, products: true, cogs: false, acquisitionRef: false, customerIdentity: true, inventory: true, webhooks: true, incrementalCursor: true },
  zid: { orders: true, refunds: true, products: true, cogs: false, acquisitionRef: false, customerIdentity: true, inventory: true, webhooks: true, incrementalCursor: true },
  shopify: { orders: true, refunds: true, products: true, cogs: true, acquisitionRef: true, customerIdentity: true, inventory: true, webhooks: true, incrementalCursor: true },
  woocommerce: { orders: true, refunds: true, products: true, cogs: false, acquisitionRef: true, customerIdentity: true, inventory: true, webhooks: true, incrementalCursor: true },
  custom: { orders: true, refunds: false, products: false, cogs: false, acquisitionRef: false, customerIdentity: false, inventory: false, webhooks: false, incrementalCursor: false },
};

/**
 * Documented semantic differences between providers (so the normalizers never assume one platform's
 * semantics equal another's). This is reference data for 03-provider-commerce-matrix.md, not logic.
 */
export const PROVIDER_SEMANTIC_NOTES: Record<CommercePlatform, string[]> = {
  salla: [
    'Order totals are typically tax-inclusive; the connector must read the tax line explicitly rather than assuming exclusive.',
    'Refunds surface as order status transitions + refund records; cancellation ≠ refund.',
    'Shopify-style "financial_status" does not exist; payment state is a separate status enum.',
  ],
  zid: [
    'Zid order lifecycle and status codes differ from Salla; do not reuse Salla status mapping.',
    'Currency is per-store; multi-currency stores require per-order currency.',
    'Refund semantics are distinct from cancellations and must be mapped separately.',
  ],
  shopify: [
    'current_total_price / subtotal / total_tax / total_discounts are discrete; refunds are a separate resource with transactions.',
    'financial_status + fulfillment_status are independent; a paid order can be unfulfilled.',
    'COGS may be available via InventoryItem.cost where the merchant populated it (still treated as merchant-config trust).',
  ],
  woocommerce: [
    'Plugins add arbitrary meta fields; unknown meta must NOT become trusted canonical facts automatically.',
    'Order status set is extensible (custom statuses); map only known statuses, keep the rest in raw.',
    'Refunds are negative line records; sum carefully and never let a refund exceed the order.',
  ],
  custom: [
    'A generic merchant must POST a validated, signed, explicit schema; arbitrary JSON is never accepted into business truth.',
    'Identity, currency, and timestamps are required; refunds/products are optional capabilities.',
  ],
};
