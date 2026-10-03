/**
 * Commerce intelligence CONTRACT (Phase 2 preparation for business truth). This defines the canonical
 * commerce entities and the connector interface for Salla / Zid / Shopify / WooCommerce / a custom
 * commerce API. Phase 2 ships the TYPED CONTRACT only; full connector implementations are Phase 3/4.
 *
 * CRITICAL TRUTH RULE: platform-attributed conversion value (what Meta/Google/TikTok report) is NOT
 * merchant revenue. They are different numbers with different trust. The canonical model keeps them
 * distinct (RevenueSignal.source) and never silently substitutes one for the other; profit/margin math
 * is only valid on merchant-sourced revenue + COGS, which stay UNKNOWN until a connector supplies them.
 */

export const COMMERCE_PLATFORMS = ['salla', 'zid', 'shopify', 'woocommerce', 'custom'] as const;
export type CommercePlatform = (typeof COMMERCE_PLATFORMS)[number];

/** Money is stored as minor units + currency (never a bare float), consistent with @adport/core Money. */
export interface CommerceMoney { minorUnits: number; currency: string }

export interface Product {
  id: string;
  platform: CommercePlatform;
  sku?: string;
  title: string;
  /** Cost of goods sold per unit, ONLY when the merchant provides it. UNKNOWN otherwise. */
  cogs?: CommerceMoney;
}

export interface OrderLine {
  productId?: string;
  sku?: string;
  title: string;
  quantity: number;
  unitPrice: CommerceMoney;
  discount?: CommerceMoney;
  /** COGS for this line when known (from Product.cogs × quantity). */
  cogs?: CommerceMoney;
}

export interface Order {
  id: string;
  platform: CommercePlatform;
  /** Merchant's order timestamp (ISO), in the store timezone. */
  placedAt: string;
  currency: string;
  lines: OrderLine[];
  /** Order-level money breakdown — merchant truth, not platform attribution. */
  subtotal: CommerceMoney;
  discountTotal?: CommerceMoney;
  taxTotal?: CommerceMoney;
  shippingTotal?: CommerceMoney;
  grandTotal: CommerceMoney;
  /** A stable, privacy-preserving acquisition reference (e.g. a hashed click id / UTM), when present. */
  acquisitionRef?: { source?: string; medium?: string; campaignRef?: string; clickIdHash?: string; anonymous: boolean };
  status: 'placed' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded' | 'partially_refunded';
}

export interface Refund {
  id: string;
  orderId: string;
  platform: CommercePlatform;
  amount: CommerceMoney;
  refundedAt: string;
  reason?: string;
}

/** Merchant-sourced revenue for a window — the authoritative figure, isolated from platform attribution. */
export interface MerchantRevenue {
  source: 'merchant';
  platform: CommercePlatform;
  currency: string;
  grossRevenue: CommerceMoney;
  netRevenue: CommerceMoney; // after refunds/discounts
  refunds: CommerceMoney;
  cogsTotal?: CommerceMoney; // only when COGS is known for the ordered products
  orderCount: number;
  window: { start: string; end: string };
}

/**
 * The connector contract. Phase 3/4 implements these against each platform's API. Everything is READ,
 * tenant-scoped (the caller supplies the authenticated organization/connection), and returns canonical
 * entities. No method writes to the store. Implementations MUST set MerchantRevenue.source = 'merchant'
 * and MUST NOT derive revenue from ad-platform conversion value.
 */
export interface CommerceConnector {
  readonly platform: CommercePlatform;
  listOrders(input: { connectionId: string; window: { start: string; end: string }; cursor?: string }): Promise<{ orders: Order[]; nextCursor?: string }>;
  listRefunds(input: { connectionId: string; window: { start: string; end: string } }): Promise<Refund[]>;
  listProducts(input: { connectionId: string }): Promise<Product[]>;
  /** Aggregate merchant revenue for the window — the authoritative truth, never platform-attributed. */
  revenue(input: { connectionId: string; window: { start: string; end: string } }): Promise<MerchantRevenue>;
  /** Declares which fields this platform can actually supply (so the model never assumes COGS/margin). */
  capabilities(): { orders: boolean; refunds: boolean; products: boolean; cogs: boolean; acquisitionRef: boolean };
}

/** Per-platform capability map (documentation foundation; implementations land in Phase 3/4). */
export const COMMERCE_CAPABILITIES: Record<CommercePlatform, ReturnType<CommerceConnector['capabilities']>> = {
  salla: { orders: true, refunds: true, products: true, cogs: false, acquisitionRef: false },
  zid: { orders: true, refunds: true, products: true, cogs: false, acquisitionRef: false },
  shopify: { orders: true, refunds: true, products: true, cogs: true, acquisitionRef: true },
  woocommerce: { orders: true, refunds: true, products: true, cogs: false, acquisitionRef: true },
  custom: { orders: true, refunds: false, products: false, cogs: false, acquisitionRef: false },
};

/**
 * Guard used by any profit/margin computation: profit math is valid ONLY on merchant revenue with
 * known COGS. Returns the reason it is not computable, else null.
 */
export function profitComputability(rev: MerchantRevenue | null): string | null {
  if (!rev) return 'no merchant revenue connected (platform conversion value is not revenue)';
  if (rev.source !== 'merchant') return 'revenue is not merchant-sourced';
  if (!rev.cogsTotal) return 'COGS unknown — margin/profit cannot be computed';
  return null;
}
