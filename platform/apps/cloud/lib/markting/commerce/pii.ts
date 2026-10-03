/**
 * Phase 5 — PII controls. Commerce data is sensitive (emails, phones, addresses, names, order notes,
 * payment metadata). Before ANY of it reaches an LLM, we project orders to an ANALYTICS-SAFE shape
 * that excludes raw customer identity and free text. Marketing intelligence does not need PII.
 *
 * - Customer identity is reduced to a tenant-scoped pseudo-id (HMAC with a per-org key) + class.
 * - Addresses, emails, phones, names, notes, payment credentials are DROPPED, not just truncated.
 * - Order notes (a prompt-injection vector) never enter model context.
 */
import { createHmac } from 'node:crypto';
import type { Order } from './model';

/** Fields that must NEVER be sent to an external model. */
export const FORBIDDEN_PII_FIELDS = [
  'email', 'phone', 'name', 'first_name', 'last_name', 'address', 'address1', 'address2',
  'city', 'zip', 'postcode', 'note', 'notes', 'customer_note', 'billing', 'shipping_address',
  'card', 'payment_method', 'payment_details', 'ip', 'ip_address',
] as const;

/** Build a tenant-scoped pseudonymous id from a raw identifier. Never store/return the raw value. */
export function pseudonymize(organizationId: string, rawIdentifier: string, orgKey: string): string {
  return createHmac('sha256', `${orgKey}:${organizationId}`).update(rawIdentifier.trim().toLowerCase()).digest('hex').slice(0, 24);
}

/** An analytics-safe order projection — the ONLY order shape that may reach a model. */
export interface AnalyticsSafeOrder {
  orderId: string;
  createdAt: string;
  currency: string;
  stage: string;
  paymentStatus: string;
  grossMinor: number;
  netMinor?: number;
  refundedMinor: number;
  customerClass: 'new' | 'returning' | 'unknown';
  identityConfidence: 'KNOWN' | 'PARTIAL' | 'UNKNOWN';
  attribution?: { utmSource?: string; utmMedium?: string; utmCampaign?: string; hasClickId: boolean };
  lineCount: number;
  /** product/sku refs only (no titles that may carry PII); titles are dropped. */
  skus: string[];
}

export function toAnalyticsSafe(order: Order): AnalyticsSafeOrder {
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    currency: order.currency,
    stage: order.stage,
    paymentStatus: order.paymentStatus,
    grossMinor: order.grossTotal.minorUnits,
    netMinor: order.netRevenue?.minorUnits,
    refundedMinor: order.refundedTotal?.minorUnits ?? 0,
    customerClass: order.customer?.classification ?? 'unknown',
    identityConfidence: order.customer?.identityConfidence ?? 'UNKNOWN',
    attribution: order.acquisition ? {
      utmSource: order.acquisition.utmSource,
      utmMedium: order.acquisition.utmMedium,
      utmCampaign: order.acquisition.utmCampaign,
      hasClickId: !!order.acquisition.clickIdHashes && Object.keys(order.acquisition.clickIdHashes).length > 0,
    } : undefined,
    lineCount: order.lines.length,
    skus: order.lines.map((l) => l.sku ?? l.productId ?? 'unknown').filter(Boolean),
  };
}

/**
 * PII key matching by SEGMENT/PHRASE (not naive substring), so prefixed/nested variants like
 * `_billing_email`, `billing_phone`, `customer.first_name`, `shipping_address_1`, `payment_method`,
 * `ip_address` are caught — while legitimate analytics keys that merely share letters (`paymentStatus`,
 * `orderNumber`, `customerClass`) are NOT false-positived. Defense-in-depth for raw provider bags;
 * `toAnalyticsSafe` remains the only model-facing path.
 */
const SENSITIVE_SEGMENTS = new Set(['email', 'phone', 'mobile', 'name', 'address', 'zip', 'postcode', 'postal', 'note', 'notes', 'ssn', 'iban', 'card', 'ip', 'pan', 'cvv']);
const SENSITIVE_PREFIXES = ['address', 'email', 'phone'];
const SENSITIVE_PHRASES = ['payment method', 'payment details', 'credit card', 'card number', 'card last'];

/** Split a key on camelCase and non-alphanumeric boundaries into lowercased segments. */
function keyPhrase(key: string): { phrase: string; segments: string[] } {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').trim().toLowerCase();
  return { phrase: spaced, segments: spaced.split(' ').filter(Boolean) };
}

function isPiiKey(key: string): boolean {
  const { phrase, segments } = keyPhrase(key);
  if (segments.some((s) => SENSITIVE_SEGMENTS.has(s) || SENSITIVE_PREFIXES.some((p) => s.startsWith(p)))) return true;
  return SENSITIVE_PHRASES.some((p) => phrase.includes(p));
}

/** Recursively strip forbidden PII keys (by substring token) from an arbitrary object. */
export function redactPii<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (isPiiKey(k)) { out[k] = '[REDACTED]'; continue; }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** True if a projection still contains any forbidden field (a test/guard tripwire). */
export function containsPii(obj: unknown): boolean {
  let found = false;
  const walk = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (isPiiKey(k) && (val as unknown) !== '[REDACTED]') { found = true; return; }
        walk(val);
      }
    }
  };
  walk(obj);
  return found;
}
