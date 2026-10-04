# C9 (webhooks) — Live commerce webhook transport

## Built + unit-tested (verifier)

`lib/markting/commerce/webhooks.ts` is the signed-webhook ingestion model, pure and tested
(`test/phase5-commerce.test.ts`):

- **HMAC-SHA256 signature verification** with `timingSafeEqual` (constant-time) — no timing oracle.
- **Order of checks**: resolve the connection → derive org + signing secret from it → verify signature
  → enforce a replay window (±5-minute skew) → dedup by `externalEventId` → record.
- **Tenant is never trusted from the payload**: org is derived server-side from the `connectionId`, so a
  forged payload cannot cross tenants.
- Covers `shopify` / `woocommerce` / `salla` / `zid` / `custom` via the `CommercePlatform` union.

## BLOCKED_EXTERNAL

- **No HTTP webhook route is mounted** for commerce providers (only `app/api/billing/webhook` exists for
  Stripe billing). Mounting the route is a live-wiring step.
- **Per-provider signature-header adapters**: the verifier assumes a single base64 HMAC scheme; Shopify
  (`X-Shopify-Hmac-SHA256`, base64 over raw body), WooCommerce (`X-WC-Webhook-Signature`), Salla and Zid
  each differ in header name and encoding. Each needs a small adapter that maps its header + canonical
  body to the verifier — straightforward but requires the provider's real signing behavior to verify,
  which is **BLOCKED_EXTERNAL** (no credentials / no live deliveries).

## Freshness coupling

A verified webhook is the `NEAR_REALTIME` freshness source (`DOMAIN_FRESHNESS.COMMERCE_WEBHOOK`, see
`10-data-freshness.md`); without a mounted route, commerce freshness falls back to the `HOURLY` sync
cadence, and the surface states that honestly rather than implying real-time.

**Status:** verifier built + tested; mounted route + per-provider header adapters BLOCKED_EXTERNAL.
