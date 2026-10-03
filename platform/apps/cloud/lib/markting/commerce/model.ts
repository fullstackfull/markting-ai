/**
 * Phase 5A — CANONICAL COMMERCE DOMAIN MODEL.
 *
 * The central truth rule of Phase 5: ad-platform-reported conversion value (what Meta/TikTok/Google
 * report) is NOT merchant business revenue. This model keeps MERCHANT truth (orders, refunds, COGS,
 * margin) entirely separate from PLATFORM attribution. Profit/margin math is valid ONLY on
 * merchant-sourced revenue with known COGS; unknown cost stays UNKNOWN (never inferred, never zero).
 *
 * Money is an explicit (minorUnits, currency) integer pair — NEVER a float. We mirror @adport/core
 * Money semantics (integer minor units of the currency's smallest denomination). Source-system ids,
 * the source platform, and a raw bag are preserved so normalization is never lossy.
 *
 * ANALYSIS ONLY: nothing in Phase 5 writes to a store, a product, an order, inventory, pricing, or an
 * ad provider. These are read/normalize/analyze shapes.
 */

export const COMMERCE_PLATFORMS = ['salla', 'zid', 'shopify', 'woocommerce', 'custom'] as const;
export type CommercePlatform = (typeof COMMERCE_PLATFORMS)[number];

/** Integer minor-units + ISO-4217 currency. Mirrors @adport/core Money; never a bare float. */
export interface CommerceMoney { minorUnits: number; currency: string }

export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'partially_refunded' | 'refunded' | 'failed' | 'voided' | 'unknown';
export type FulfillmentStatus = 'unfulfilled' | 'partially_fulfilled' | 'fulfilled' | 'returned' | 'cancelled' | 'unknown';
/** The order's lifecycle stage, distinct from payment/fulfillment, used to decide the revenue basis. */
export type OrderStage = 'placed' | 'paid' | 'fulfilled' | 'cancelled' | 'failed' | 'refunded' | 'partially_refunded';

/** Deterministic commerce trust tiers (see trust.ts for the rules that assign them). */
export const COMMERCE_TRUST_TIERS = [
  'PLATFORM_ORDER', 'PAID_ORDER', 'FULFILLED_ORDER', 'REFUND_VERIFIED', 'COST_CONFIGURED', 'COST_VERIFIED', 'CUSTOMER_ID_PARTIAL',
] as const;
export type CommerceTrustTier = (typeof COMMERCE_TRUST_TIERS)[number];

export interface Provenance {
  /** The source platform that supplied this fact. */
  platform: CommercePlatform;
  /** The source-system id, preserved verbatim. */
  sourceId: string;
  /** Who/what established it (a connector read, a merchant config, an ERP feed, a webhook). */
  origin: 'connector_read' | 'merchant_config' | 'erp_feed' | 'webhook' | 'manual_import';
  /** ISO timestamp the fact was observed/ingested. */
  observedAt?: string;
  /** Commerce trust tiers that apply to this fact. */
  tiers: CommerceTrustTier[];
}

export interface Store {
  storeId: string;              // canonical id (platform:externalId)
  organizationId: string;
  workspaceId?: string;
  platform: CommercePlatform;
  externalStoreId: string;
  name?: string;
  currency?: string;            // store default currency
  timezone?: string;
  raw?: Record<string, unknown>;
}

export interface StoreConnection {
  connectionId: string;
  organizationId: string;
  workspaceId?: string;
  storeId: string;
  platform: CommercePlatform;
  /** Opaque reference to where credentials live (a secret ref) — NEVER the secret itself. */
  credentialRef?: string;
  status: 'active' | 'revoked' | 'error' | 'pending';
  scopes: string[];             // granted read scopes
  createdAt?: string;
}

export interface Variant {
  variantId: string;
  productId: string;
  sku?: string;
  title?: string;
  raw?: Record<string, unknown>;
}

export interface Product {
  productId: string;            // canonical id (platform:externalId)
  platform: CommercePlatform;
  externalProductId: string;
  sku?: string;
  title: string;
  variants?: Variant[];
  raw?: Record<string, unknown>;
}

/** Per-unit cost of goods, ONLY when a trusted source supplies it. Never inferred from selling price. */
export interface CostObservation {
  productId?: string;
  variantId?: string;
  sku?: string;
  unitCost: CommerceMoney;
  provenance: Provenance;       // tiers include COST_CONFIGURED or COST_VERIFIED
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface OrderLine {
  lineId: string;
  productId?: string;
  variantId?: string;
  sku?: string;
  title: string;
  quantity: number;
  unitPrice: CommerceMoney;
  /** Discount allocated to this line (order-level discounts allocated down), when known. */
  discountAllocated?: CommerceMoney;
  /** Tax allocated to this line, when known. */
  taxAllocated?: CommerceMoney;
  /** Net revenue for this line (unitPrice×qty − discountAllocated), merchant-sourced. */
  netRevenue?: CommerceMoney;
  /** COGS for this line (unitCost×qty) — ONLY when cost is known; undefined = UNKNOWN. */
  cogs?: CommerceMoney;
  raw?: Record<string, unknown>;
}

/** Privacy-conscious customer reference — a scoped pseudonymous id, never raw email/phone as the key. */
export interface CustomerReference {
  /** Tenant-scoped pseudonymous id (e.g. HMAC of a normalized identifier with a per-org key). */
  pseudoId?: string;
  classification: 'new' | 'returning' | 'unknown';
  /** How confident the new/returning classification is. */
  identityConfidence: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
}

/** Merchant-side acquisition metadata — UTM/referrer/clickIds. Not deterministic attribution by itself. */
export interface AcquisitionRef {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Provider click ids, HASHED (never raw) where used as analytics keys. */
  clickIdHashes?: Record<string, string>;
  landingPage?: string;
  referrer?: string;
  anonymous: boolean;
}

export interface Order {
  orderId: string;              // canonical id (platform:storeExternalId:externalOrderId)
  organizationId: string;
  workspaceId?: string;
  storeId: string;
  platform: CommercePlatform;
  externalOrderId: string;
  orderNumber?: string;
  createdAt: string;            // ISO, merchant timestamp
  paidAt?: string;
  fulfilledAt?: string;
  cancelledAt?: string;
  currency: string;
  // Money breakdown — MERCHANT truth, not platform attribution. All integer minor units.
  subtotal: CommerceMoney;
  discountTotal?: CommerceMoney;
  taxTotal?: CommerceMoney;
  shippingTotal?: CommerceMoney;
  grossTotal: CommerceMoney;    // what the customer was charged
  refundedTotal?: CommerceMoney;
  netRevenue?: CommerceMoney;   // computed by the revenue engine under an explicit basis
  stage: OrderStage;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  customer?: CustomerReference;
  acquisition?: AcquisitionRef;
  lines: OrderLine[];
  provenance: Provenance;
  raw?: Record<string, unknown>;
}

export interface Refund {
  refundId: string;
  orderId: string;
  organizationId: string;
  storeId: string;
  platform: CommercePlatform;
  externalRefundId: string;
  amount: CommerceMoney;
  kind: 'full' | 'partial';
  refundedAt: string;
  reason?: string;
  lineRefs?: string[];          // lineIds this refund touched, when known
  provenance: Provenance;
  raw?: Record<string, unknown>;
}

export interface Discount {
  code?: string;
  amount: CommerceMoney;
  kind?: 'percentage' | 'fixed' | 'shipping' | 'unknown';
}

/** A revenue figure for a window under an EXPLICIT basis — the authoritative merchant truth. */
export interface RevenueObservation {
  source: 'merchant';
  platform?: CommercePlatform;  // undefined for multi-store aggregate
  storeId?: string;
  currency: string;             // undefined-safe: mixed currency is handled by the revenue engine
  basis: RevenueBasis;
  grossSales: CommerceMoney;    // sum of gross line value before discounts/refunds
  discounts: CommerceMoney;
  refunds: CommerceMoney;
  tax: CommerceMoney;
  shipping: CommerceMoney;
  netRevenue: CommerceMoney;    // computed per the basis
  orderCount: number;
  window: { start: string; end: string };
  mixedCurrency: boolean;
}

/** The explicit definition used to compute net revenue — never chosen silently. */
export interface RevenueBasis {
  /** Which order stages count toward revenue (e.g. paid+fulfilled, or placed). */
  countStages: OrderStage[];
  includeTax: boolean;
  includeShipping: boolean;
  deductRefunds: boolean;
  deductDiscounts: boolean;
  label: string;                // e.g. 'net_paid_excl_tax_excl_shipping'
}

/** A margin figure — valid ONLY on merchant revenue with known COGS and a declared contribution set. */
export interface MarginObservation {
  grossProfit?: CommerceMoney;
  grossMarginPct?: number;
  contributionProfit?: CommerceMoney;
  contributionMarginPct?: number;
  /** Which cost components were included (so the number is never mistaken for a different definition). */
  contributionComponents: string[];
  /** Why margin is not computable, when it isn't (e.g. 'COGS unknown'). */
  notComputableReason?: string;
  currency?: string;
}

// ---- Deterministic canonical id builders (stable, collision-resistant within a tenant+platform) ----
export function storeId(platform: CommercePlatform, externalStoreId: string): string {
  return `${platform}:${externalStoreId}`;
}
export function orderId(platform: CommercePlatform, externalStoreId: string, externalOrderId: string): string {
  return `${platform}:${externalStoreId}:${externalOrderId}`;
}
export function productId(platform: CommercePlatform, externalProductId: string): string {
  return `${platform}:${externalProductId}`;
}

// ---- Integer money helpers (fail closed on mixed currency; never float) ----
export function zeroMoney(currency: string): CommerceMoney { return { minorUnits: 0, currency }; }

/** Add money of the SAME currency. Throws on a currency mismatch (never blends currencies). */
export function addMoney(a: CommerceMoney, b: CommerceMoney): CommerceMoney {
  if (a.currency !== b.currency) throw new Error(`cannot add ${a.currency} + ${b.currency} (mixed currency)`);
  return { minorUnits: a.minorUnits + b.minorUnits, currency: a.currency };
}
export function subMoney(a: CommerceMoney, b: CommerceMoney): CommerceMoney {
  if (a.currency !== b.currency) throw new Error(`cannot subtract ${b.currency} from ${a.currency} (mixed currency)`);
  return { minorUnits: a.minorUnits - b.minorUnits, currency: a.currency };
}
export function mulMoney(a: CommerceMoney, qty: number): CommerceMoney {
  if (!Number.isInteger(qty)) throw new Error(`quantity must be an integer, got ${qty}`);
  return { minorUnits: a.minorUnits * qty, currency: a.currency };
}
/** Sum a list of same-currency money; returns null (not zero) if the list mixes currencies. */
export function sumMoney(items: CommerceMoney[], currency?: string): CommerceMoney | null {
  if (items.length === 0) return currency ? zeroMoney(currency) : null;
  const cur = currency ?? items[0]!.currency;
  let minor = 0;
  for (const m of items) { if (m.currency !== cur) return null; minor += m.minorUnits; }
  return { minorUnits: minor, currency: cur };
}
