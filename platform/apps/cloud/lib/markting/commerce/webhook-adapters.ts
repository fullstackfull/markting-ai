/**
 * PHASE C.5 (3) — PER-PROVIDER WEBHOOK ADAPTERS (pure, no live Request, no secrets).
 *
 * A webhook payload is UNTRUSTED input. These adapters do the provider-specific *shape* work only:
 * given the incoming headers (a case-insensitive getter) and the exact raw body string, extract the
 * common verification inputs the pure verifier needs — the signature (normalized to base64), the EXACT
 * bytes that were HMAC'd (`signedPayload`), a stable per-delivery id (for dedup), the topic, and the
 * provider event timestamp (for the replay window).
 *
 * They do NOT verify anything, do NOT resolve the tenant, and NEVER read an organization/store id from
 * the body — tenant identity is derived only from the trusted connection (see webhook-ingress.ts). The
 * only body fields ever read here are the non-security topic/timestamp/event-id gate fields, and only
 * because some providers carry them nowhere else; the HMAC over the whole body is the real authenticator.
 *
 * Each provider declares an event-type ALLOWLIST; an unknown topic is rejected before any work.
 */
import type { CommercePlatform } from './model';

/** Every provider this ingress has code support for. */
export const WEBHOOK_PROVIDERS = ['shopify', 'woocommerce', 'salla', 'zid', 'stripe'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

/** Providers whose verified webhook enqueues a commerce sync. Stripe (billing) is verified but not synced. */
export const COMMERCE_WEBHOOK_PROVIDERS = ['shopify', 'woocommerce', 'salla', 'zid'] as const;

export function isWebhookProvider(p: string): p is WebhookProvider {
  return (WEBHOOK_PROVIDERS as readonly string[]).includes(p);
}

/** A verified commerce provider maps 1:1 onto a CommercePlatform of the same name. */
export function commercePlatformFor(p: WebhookProvider): CommercePlatform | null {
  return (COMMERCE_WEBHOOK_PROVIDERS as readonly string[]).includes(p) ? (p as CommercePlatform) : null;
}

/** Case-insensitive header accessor — satisfied by the Web `Headers` object and by a plain test map. */
export type HeaderGetter = (name: string) => string | null | undefined;

/** The common, provider-agnostic shape the verifier + ingress consume. */
export interface WebhookExtract {
  /** Provider signature normalized to base64, ready for timing-safe compare against a base64 HMAC. */
  signatureB64: string;
  /** The EXACT bytes that were HMAC'd. Usually the raw body; Stripe signs `${t}.${rawBody}`. */
  signedPayload: string;
  /** Stable per-delivery identity for dedup (provider id when available, else the signature itself). */
  externalEventId: string;
  /** Provider topic / event type (already allowlist-checked). */
  topic: string;
  /** Provider event time as an ISO-8601 string, for the replay window. */
  timestamp: string;
}

export type ExtractReason = 'MISSING_SIGNATURE' | 'MISSING_HEADERS' | 'UNKNOWN_TOPIC' | 'MALFORMED';
export type ExtractResult = { ok: true; value: WebhookExtract } | { ok: false; reason: ExtractReason };

/** Per-provider event-type ALLOWLIST — any topic outside the set is rejected (UNKNOWN_TOPIC). */
export const EVENT_ALLOWLIST: Record<WebhookProvider, ReadonlySet<string>> = {
  shopify: new Set([
    'orders/create', 'orders/updated', 'orders/paid', 'orders/cancelled', 'orders/fulfilled',
    'orders/partially_fulfilled', 'refunds/create', 'products/create', 'products/update',
    'products/delete', 'inventory_levels/update', 'app/uninstalled',
  ]),
  woocommerce: new Set([
    'order.created', 'order.updated', 'order.deleted', 'order.restored',
    'product.created', 'product.updated', 'product.deleted',
    'customer.created', 'customer.updated',
  ]),
  salla: new Set([
    'order.created', 'order.updated', 'order.status.updated', 'order.payment.updated',
    'order.refunded', 'product.created', 'product.updated', 'product.deleted',
    'customer.created', 'app.store.authorize',
  ]),
  zid: new Set([
    'order.create', 'order.status.update', 'order.payment_status.update', 'order.refund',
    'product.create', 'product.update', 'product.publish',
  ]),
  stripe: new Set([
    'checkout.session.completed', 'payment_intent.succeeded', 'charge.refunded',
    'invoice.paid', 'invoice.payment_failed',
    'customer.subscription.updated', 'customer.subscription.deleted',
  ]),
};

const nonEmpty = (v: string | null | undefined): v is string => typeof v === 'string' && v.length > 0;

/** Parse the body once, defensively. Returns {} on any malformed input — the HMAC is what authenticates. */
function safeJson(rawBody: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null);

/** Normalize a hex signature to base64 (Salla/Zid/Stripe sign in hex). Returns null on non-hex input. */
function hexToB64(hex: string): string | null {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return null;
  return Buffer.from(clean, 'hex').toString('base64');
}

/** GMT timestamps without an explicit zone (WooCommerce `*_gmt`) are UTC — make that explicit. */
function asUtcIso(v: string | null): string | null {
  if (!v) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(v);
  return hasZone ? v : `${v}Z`;
}

function extractShopify(get: HeaderGetter, rawBody: string): ExtractResult {
  const sig = get('x-shopify-hmac-sha256');
  const topic = get('x-shopify-topic');
  if (!nonEmpty(sig)) return { ok: false, reason: 'MISSING_SIGNATURE' };
  if (!nonEmpty(topic)) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!EVENT_ALLOWLIST.shopify.has(topic)) return { ok: false, reason: 'UNKNOWN_TOPIC' };
  const triggeredAt = get('x-shopify-triggered-at');
  if (!nonEmpty(triggeredAt)) return { ok: false, reason: 'MISSING_HEADERS' };
  const eventId = get('x-shopify-webhook-id');
  return {
    ok: true,
    value: {
      signatureB64: sig,
      signedPayload: rawBody,
      topic,
      timestamp: triggeredAt,
      externalEventId: nonEmpty(eventId) ? eventId : sig,
    },
  };
}

function extractWoo(get: HeaderGetter, rawBody: string): ExtractResult {
  const sig = get('x-wc-webhook-signature');
  const topic = get('x-wc-webhook-topic');
  if (!nonEmpty(sig)) return { ok: false, reason: 'MISSING_SIGNATURE' };
  if (!nonEmpty(topic)) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!EVENT_ALLOWLIST.woocommerce.has(topic)) return { ok: false, reason: 'UNKNOWN_TOPIC' };
  const body = safeJson(rawBody);
  // WooCommerce carries no signed timestamp header; the body's own GMT dates are the best source.
  const ts = asUtcIso(str(body.date_modified_gmt) ?? str(body.date_created_gmt) ?? str(body.date_created));
  if (!ts) return { ok: false, reason: 'MALFORMED' };
  const deliveryId = get('x-wc-webhook-delivery-id') ?? get('x-wc-webhook-id');
  return {
    ok: true,
    value: {
      signatureB64: sig,
      signedPayload: rawBody,
      topic,
      timestamp: ts,
      externalEventId: nonEmpty(deliveryId) ? deliveryId : sig,
    },
  };
}

function extractSalla(get: HeaderGetter, rawBody: string): ExtractResult {
  const sigHex = get('x-salla-signature');
  if (!nonEmpty(sigHex)) return { ok: false, reason: 'MISSING_SIGNATURE' };
  const sig = hexToB64(sigHex);
  if (!sig) return { ok: false, reason: 'MALFORMED' };
  const body = safeJson(rawBody);
  const topic = str(body.event);
  if (!topic) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!EVENT_ALLOWLIST.salla.has(topic)) return { ok: false, reason: 'UNKNOWN_TOPIC' };
  const ts = asUtcIso(str(body.created_at));
  if (!ts) return { ok: false, reason: 'MALFORMED' };
  const eventId = get('x-salla-webhook-id');
  return {
    ok: true,
    value: {
      signatureB64: sig,
      signedPayload: rawBody,
      topic,
      timestamp: ts,
      externalEventId: nonEmpty(eventId) ? eventId : sig,
    },
  };
}

function extractZid(get: HeaderGetter, rawBody: string): ExtractResult {
  const sigHex = get('x-zid-signature');
  if (!nonEmpty(sigHex)) return { ok: false, reason: 'MISSING_SIGNATURE' };
  const sig = hexToB64(sigHex);
  if (!sig) return { ok: false, reason: 'MALFORMED' };
  const body = safeJson(rawBody);
  const topic = str(body.event);
  if (!topic) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!EVENT_ALLOWLIST.zid.has(topic)) return { ok: false, reason: 'UNKNOWN_TOPIC' };
  const ts = asUtcIso(str(body.created_at));
  if (!ts) return { ok: false, reason: 'MALFORMED' };
  const eventId = get('x-zid-webhook-id');
  return {
    ok: true,
    value: {
      signatureB64: sig,
      signedPayload: rawBody,
      topic,
      timestamp: ts,
      externalEventId: nonEmpty(eventId) ? eventId : sig,
    },
  };
}

function extractStripe(get: HeaderGetter, rawBody: string): ExtractResult {
  // Stripe-Signature: `t=<unix-seconds>,v1=<hex-hmac>`; the signed payload is `${t}.${rawBody}`.
  const header = get('stripe-signature');
  if (!nonEmpty(header)) return { ok: false, reason: 'MISSING_SIGNATURE' };
  let t: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const [k, val] = part.split('=');
    if (k?.trim() === 't') t = val?.trim();
    else if (k?.trim() === 'v1') v1 = val?.trim();
  }
  if (!t || !v1) return { ok: false, reason: 'MISSING_SIGNATURE' };
  const sig = hexToB64(v1);
  if (!sig) return { ok: false, reason: 'MALFORMED' };
  const seconds = Number(t);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'MALFORMED' };
  const body = safeJson(rawBody);
  const topic = str(body.type);
  if (!topic) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!EVENT_ALLOWLIST.stripe.has(topic)) return { ok: false, reason: 'UNKNOWN_TOPIC' };
  const eventId = str(body.id);
  return {
    ok: true,
    value: {
      signatureB64: sig,
      signedPayload: `${t}.${rawBody}`,
      topic,
      timestamp: new Date(seconds * 1000).toISOString(),
      externalEventId: eventId ?? sig,
    },
  };
}

const ADAPTERS: Record<WebhookProvider, (get: HeaderGetter, rawBody: string) => ExtractResult> = {
  shopify: extractShopify,
  woocommerce: extractWoo,
  salla: extractSalla,
  zid: extractZid,
  stripe: extractStripe,
};

/** Pure entry point: map a provider's headers + raw body onto the common verification inputs. */
export function extractWebhook(provider: WebhookProvider, get: HeaderGetter, rawBody: string): ExtractResult {
  return ADAPTERS[provider](get, rawBody);
}
