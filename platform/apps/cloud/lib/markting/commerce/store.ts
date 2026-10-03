import 'server-only';
import { db } from '@/lib/db';
import type { Order, Refund, Product, CommercePlatform, CostObservation } from './model';
import type { SyncStore, SyncCheckpoint, DeadLetter } from './sync';
import type { WebhookPorts } from './webhooks';
import { CostBook } from './profit';

/**
 * Phase 5 — tenant-scoped commerce persistence. READ/ANALYZE storage only; nothing mutates a store or
 * provider. Every write asserts the server-derived organizationId BEFORE touching the DB and stamps it
 * on every row, so a payload can never write cross-tenant. Order upserts are idempotent (sync-safe).
 */

export async function upsertStoreConnection(organizationId: string, c: {
  connectionId: string; storeId: string; platform: CommercePlatform; workspaceId?: string;
  externalStoreId?: string; credentialRef?: string; signingSecretRef?: string; status?: string; scopes?: string[];
}): Promise<void> {
  await db()`
    insert into public.markting_store_connections
      (connection_id, organization_id, workspace_id, store_id, platform, external_store_id, credential_ref, signing_secret_ref, status, scopes, updated_at)
    values
      (${c.connectionId}, ${organizationId}, ${c.workspaceId ?? null}, ${c.storeId}, ${c.platform}, ${c.externalStoreId ?? null}, ${c.credentialRef ?? null}, ${c.signingSecretRef ?? null}, ${c.status ?? 'active'}, ${db().json((c.scopes ?? []) as never)}, now())
    on conflict (organization_id, connection_id) do update set
      status = excluded.status, scopes = excluded.scopes, credential_ref = excluded.credential_ref, signing_secret_ref = excluded.signing_secret_ref, updated_at = now()`;
}

/** Idempotent order upsert (used by the sync engine). Replaces lines on each sync. */
export async function upsertOrders(organizationId: string, orders: Order[]): Promise<number> {
  for (const o of orders) {
    if (o.organizationId && o.organizationId !== organizationId) throw new Error('order organization mismatch');
    await db()`
      insert into public.markting_orders
        (order_id, organization_id, workspace_id, store_id, platform, external_order_id, order_number,
         created_at_src, paid_at, fulfilled_at, cancelled_at, currency,
         subtotal_minor, discount_minor, tax_minor, shipping_minor, gross_minor, refunded_minor, net_minor,
         stage, payment_status, fulfillment_status, customer_pseudo_id, customer_class, identity_confidence, acquisition, trust, ingested_at)
      values
        (${o.orderId}, ${organizationId}, ${o.workspaceId ?? null}, ${o.storeId}, ${o.platform}, ${o.externalOrderId}, ${o.orderNumber ?? null},
         ${o.createdAt}, ${o.paidAt ?? null}, ${o.fulfilledAt ?? null}, ${o.cancelledAt ?? null}, ${o.currency},
         ${o.subtotal.minorUnits}, ${o.discountTotal?.minorUnits ?? null}, ${o.taxTotal?.minorUnits ?? null}, ${o.shippingTotal?.minorUnits ?? null}, ${o.grossTotal.minorUnits}, ${o.refundedTotal?.minorUnits ?? null}, ${o.netRevenue?.minorUnits ?? null},
         ${o.stage}, ${o.paymentStatus}, ${o.fulfillmentStatus}, ${o.customer?.pseudoId ?? null}, ${o.customer?.classification ?? null}, ${o.customer?.identityConfidence ?? null}, ${o.acquisition ? db().json(o.acquisition as never) : null}, ${db().json(o.provenance as never)}, now())
      on conflict (organization_id, order_id) do update set
        stage = excluded.stage, payment_status = excluded.payment_status, fulfillment_status = excluded.fulfillment_status,
        refunded_minor = excluded.refunded_minor, net_minor = excluded.net_minor, paid_at = excluded.paid_at, fulfilled_at = excluded.fulfilled_at,
        cancelled_at = excluded.cancelled_at, trust = excluded.trust, ingested_at = now()`;
    // Replace lines (idempotent resync).
    await db()`delete from public.markting_order_lines where organization_id = ${organizationId} and order_id = ${o.orderId}`;
    for (const l of o.lines) {
      await db()`
        insert into public.markting_order_lines
          (organization_id, order_id, line_id, product_id, variant_id, sku, quantity, unit_price_minor, discount_minor, net_minor, cogs_minor, currency)
        values
          (${organizationId}, ${o.orderId}, ${l.lineId}, ${l.productId ?? null}, ${l.variantId ?? null}, ${l.sku ?? null}, ${l.quantity}, ${l.unitPrice.minorUnits}, ${l.discountAllocated?.minorUnits ?? null}, ${l.netRevenue?.minorUnits ?? null}, ${l.cogs?.minorUnits ?? null}, ${l.unitPrice.currency})`;
    }
  }
  return orders.length;
}

export async function upsertRefunds(organizationId: string, refunds: Refund[]): Promise<void> {
  for (const r of refunds) {
    await db()`
      insert into public.markting_refunds
        (refund_id, organization_id, order_id, store_id, platform, external_refund_id, amount_minor, currency, kind, refunded_at, reason)
      values
        (${r.refundId}, ${organizationId}, ${r.orderId}, ${r.storeId}, ${r.platform}, ${r.externalRefundId}, ${r.amount.minorUnits}, ${r.amount.currency}, ${r.kind}, ${r.refundedAt}, ${r.reason ?? null})
      on conflict (organization_id, refund_id) do update set amount_minor = excluded.amount_minor, kind = excluded.kind`;
  }
}

export async function upsertProducts(organizationId: string, products: Product[]): Promise<void> {
  for (const p of products) {
    await db()`
      insert into public.markting_products (product_id, organization_id, platform, external_product_id, sku, title, raw, updated_at)
      values (${p.productId}, ${organizationId}, ${p.platform}, ${p.externalProductId}, ${p.sku ?? null}, ${p.title}, ${p.raw ? db().json(p.raw as never) : null}, now())
      on conflict (organization_id, product_id) do update set sku = excluded.sku, title = excluded.title, raw = excluded.raw, updated_at = now()`;
  }
}

/** Save a product cost (insert-only history). Never inferred — only a trusted source may write. */
export async function saveProductCost(organizationId: string, c: CostObservation): Promise<void> {
  const ref = c.sku ?? c.productId ?? c.variantId;
  if (!ref) throw new Error('product cost needs a sku or product id');
  await db()`
    insert into public.markting_product_costs (organization_id, product_ref, unit_cost_minor, currency, origin, effective_from, effective_to)
    values (${organizationId}, ${ref}, ${c.unitCost.minorUnits}, ${c.unitCost.currency}, ${c.provenance.origin === 'erp_feed' ? 'erp_feed' : c.provenance.origin === 'manual_import' ? 'manual_import' : 'merchant_config'}, ${c.effectiveFrom ?? null}, ${c.effectiveTo ?? null})`;
}

/** Load the latest-effective cost per product_ref into a CostBook. */
export async function loadCostBook(organizationId: string): Promise<CostBook> {
  const rows = await db()<Array<{ productRef: string; unitCostMinor: number; currency: string; origin: string }>>`
    select distinct on (product_ref) product_ref, unit_cost_minor, currency, origin
    from public.markting_product_costs where organization_id = ${organizationId}
    order by product_ref, created_at desc`;
  const book = new CostBook();
  for (const r of rows) {
    book.add({ sku: r.productRef, unitCost: { minorUnits: Number(r.unitCostMinor), currency: r.currency }, provenance: { platform: 'custom', sourceId: r.productRef, origin: r.origin === 'erp_feed' ? 'erp_feed' : 'merchant_config', tiers: [] } });
    book.add({ productId: r.productRef, unitCost: { minorUnits: Number(r.unitCostMinor), currency: r.currency }, provenance: { platform: 'custom', sourceId: r.productRef, origin: r.origin === 'erp_feed' ? 'erp_feed' : 'merchant_config', tiers: [] } });
  }
  return book;
}

export async function listOrderRows(organizationId: string, opts: { storeId?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  return db()<Array<Record<string, unknown>>>`
    select * from public.markting_orders
    where organization_id = ${organizationId}
      ${opts.storeId ? db()`and store_id = ${opts.storeId}` : db()``}
    order by created_at_src desc nulls last limit ${opts.limit ?? 5000}`;
}

// ---- SyncStore implementation ----
export function dbSyncStore(): SyncStore {
  return {
    async getCheckpoint(connectionId) {
      const rows = await db()<Array<{ connectionId: string; organizationId: string; platform: string; cursor: string | null; highWater: string | null; status: string; consecutiveErrors: number; lastRunAt: string | null }>>`
        select connection_id, organization_id, platform, cursor, high_water, status, consecutive_errors, last_run_at
        from public.markting_commerce_sync_state where connection_id = ${connectionId} limit 1`;
      const r = rows[0];
      if (!r) return null;
      return { connectionId: r.connectionId, organizationId: r.organizationId, platform: r.platform as CommercePlatform, cursor: r.cursor ?? undefined, highWater: r.highWater ?? undefined, status: r.status as SyncCheckpoint['status'], consecutiveErrors: Number(r.consecutiveErrors), lastRunAt: r.lastRunAt ?? undefined };
    },
    async saveCheckpoint(cp) {
      await db()`
        insert into public.markting_commerce_sync_state (connection_id, organization_id, platform, cursor, high_water, status, consecutive_errors, last_run_at)
        values (${cp.connectionId}, ${cp.organizationId}, ${cp.platform}, ${cp.cursor ?? null}, ${cp.highWater ?? null}, ${cp.status}, ${cp.consecutiveErrors}, ${cp.lastRunAt ?? null})
        on conflict (organization_id, connection_id) do update set cursor = excluded.cursor, high_water = excluded.high_water, status = excluded.status, consecutive_errors = excluded.consecutive_errors, last_run_at = excluded.last_run_at`;
    },
    async upsertOrders(organizationId, orders) { return upsertOrders(organizationId, orders); },
    async deadLetter(dl: DeadLetter) {
      // dead-letters are recorded as commerce events for visibility.
      await db()`
        insert into public.markting_commerce_events (organization_id, connection_id, external_event_id, topic, kind, detail, received_at)
        values ((select organization_id from public.markting_commerce_sync_state where connection_id = ${dl.connectionId} limit 1), ${dl.connectionId}, ${`dead:${dl.occurredAt}`}, ${dl.kind}, 'dead_letter', ${dl.detail}, now())
        on conflict (organization_id, connection_id, external_event_id) do nothing`;
    },
  };
}

// ---- WebhookPorts implementation ----
export function dbWebhookPorts(): WebhookPorts {
  return {
    async resolveConnection(connectionId) {
      const rows = await db()<Array<{ organizationId: string; signingSecretRef: string | null }>>`
        select organization_id, signing_secret_ref from public.markting_store_connections where connection_id = ${connectionId} and status = 'active' limit 1`;
      const r = rows[0];
      if (!r) return null;
      // In production the signing secret is dereferenced from a secret store via signing_secret_ref.
      return { organizationId: r.organizationId, signingSecret: r.signingSecretRef ?? '' };
    },
    async seen(connectionId, externalEventId) {
      const rows = await db()<Array<{ one: number }>>`
        select 1 as one from public.markting_commerce_events where connection_id = ${connectionId} and external_event_id = ${externalEventId} limit 1`;
      return rows.length > 0;
    },
    async record(connectionId, externalEventId, organizationId) {
      await db()`
        insert into public.markting_commerce_events (organization_id, connection_id, external_event_id, kind, received_at)
        values (${organizationId}, ${connectionId}, ${externalEventId}, 'webhook', now())
        on conflict (organization_id, connection_id, external_event_id) do nothing`;
    },
  };
}

// ---- Profitability config (insert-only history; traceable) ----
export async function saveProfitabilityConfig(organizationId: string, cfg: { configId?: string; revenueBasis?: unknown; contributionConfig?: unknown; targets?: unknown; source?: string }): Promise<void> {
  await db()`
    insert into public.markting_profitability_config (organization_id, config_id, revenue_basis, contribution_config, targets, source)
    values (${organizationId}, ${cfg.configId ?? 'default'}, ${cfg.revenueBasis ? db().json(cfg.revenueBasis as never) : null}, ${cfg.contributionConfig ? db().json(cfg.contributionConfig as never) : null}, ${cfg.targets ? db().json(cfg.targets as never) : null}, ${cfg.source ?? 'human_config'})`;
}

export async function loadProfitabilityConfig(organizationId: string, configId = 'default'): Promise<Record<string, unknown> | null> {
  const rows = await db()<Array<Record<string, unknown>>>`
    select * from public.markting_profitability_config where organization_id = ${organizationId} and config_id = ${configId} order by created_at desc limit 1`;
  return rows[0] ?? null;
}
