/**
 * Phase 5 — COMMERCE DATA QUALITY. Business metrics must fail CLOSED on corrupted input: a refund
 * larger than its order, a negative total, an impossible quantity, a future timestamp, a missing
 * currency, or a duplicate order must be flagged and excluded from trusted aggregates rather than
 * silently poisoning revenue/margin. These are deterministic checks over canonical entities.
 */
import type { Order, Refund } from './model';

export type DataQualityCode =
  | 'DUPLICATE_ORDER' | 'MISSING_CURRENCY' | 'NEGATIVE_TOTAL' | 'REFUND_EXCEEDS_ORDER'
  | 'UNKNOWN_PRODUCT' | 'MISSING_PAID_TIMESTAMP' | 'FUTURE_TIMESTAMP' | 'IMPOSSIBLE_QUANTITY'
  | 'MIXED_CURRENCY_LINES' | 'SYNC_GAP';

export interface DataQualityIssue {
  code: DataQualityCode;
  orderId?: string;
  refundId?: string;
  detail: string;
  severity: 'ERROR' | 'WARN';
}

export interface DataQualityReport {
  issues: DataQualityIssue[];
  /** order ids that must be EXCLUDED from trusted revenue/margin aggregates (hard ERRORs). */
  excludedOrderIds: Set<string>;
  ok: boolean;
}

/** Validate a batch of orders + refunds. Hard errors exclude the order from trusted aggregates. */
export function assessDataQuality(orders: Order[], refunds: Refund[] = [], opts: { now?: number } = {}): DataQualityReport {
  const now = opts.now ?? Date.now();
  const issues: DataQualityIssue[] = [];
  const excluded = new Set<string>();
  const seen = new Set<string>();

  const refundsByOrder = new Map<string, number>();
  for (const r of refunds) refundsByOrder.set(r.orderId, (refundsByOrder.get(r.orderId) ?? 0) + r.amount.minorUnits);

  for (const o of orders) {
    const err = (code: DataQualityCode, detail: string) => { issues.push({ code, orderId: o.orderId, detail, severity: 'ERROR' }); excluded.add(o.orderId); };
    const warn = (code: DataQualityCode, detail: string) => issues.push({ code, orderId: o.orderId, detail, severity: 'WARN' });

    if (seen.has(o.orderId)) err('DUPLICATE_ORDER', `order ${o.orderId} appears more than once`);
    seen.add(o.orderId);

    if (!o.currency || !o.grossTotal.currency) err('MISSING_CURRENCY', 'order has no currency');
    if (o.grossTotal.minorUnits < 0 || o.subtotal.minorUnits < 0) err('NEGATIVE_TOTAL', 'order has a negative total');

    // PREFER ONE refund source (records else order-level total) — summing both double-counts and would
    // trip a false REFUND_EXCEEDS_ORDER that wrongly excludes a valid order from revenue.
    const refundedMinor = refundsByOrder.get(o.orderId) ?? (o.refundedTotal?.minorUnits ?? 0);
    if (refundedMinor > o.grossTotal.minorUnits) err('REFUND_EXCEEDS_ORDER', `refunds (${refundedMinor}) exceed gross total (${o.grossTotal.minorUnits})`);

    if ((o.paymentStatus === 'paid') && !o.paidAt) warn('MISSING_PAID_TIMESTAMP', 'paid order has no paid timestamp');

    const created = Date.parse(o.createdAt);
    if (Number.isFinite(created) && created > now + 86_400_000) err('FUTURE_TIMESTAMP', `createdAt ${o.createdAt} is in the future`);

    const lineCurrencies = new Set(o.lines.map((l) => l.unitPrice.currency));
    if (lineCurrencies.size > 1) err('MIXED_CURRENCY_LINES', 'order lines mix currencies');

    for (const l of o.lines) {
      if (!Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > 100_000) { err('IMPOSSIBLE_QUANTITY', `line ${l.lineId} quantity ${l.quantity}`); }
      if (!l.productId && !l.sku) warn('UNKNOWN_PRODUCT', `line ${l.lineId} has no product/sku`);
    }
  }

  // refund-level: a refund whose order is absent from the batch is a WARN (sync gap), not a silent drop.
  const orderIds = new Set(orders.map((o) => o.orderId));
  for (const r of refunds) {
    if (!orderIds.has(r.orderId)) issues.push({ code: 'SYNC_GAP', refundId: r.refundId, detail: `refund ${r.refundId} references order ${r.orderId} not in this batch`, severity: 'WARN' });
    if (r.amount.minorUnits < 0) issues.push({ code: 'NEGATIVE_TOTAL', refundId: r.refundId, detail: 'refund amount is negative', severity: 'ERROR' });
  }

  return { issues, excludedOrderIds: excluded, ok: issues.every((i) => i.severity !== 'ERROR') };
}
