# 05 — Commerce Lifecycle

Connectors: `salla, zid, shopify, woocommerce, custom` (`lib/markting/commerce`). All are **read-only** and
normalize orders/products/refunds into one canonical model with correct per-platform semantics
(Salla/Zid tax-inclusive totals; Shopify discrete financial/fulfillment status + InventoryItem cost COGS;
Woo negative-line refunds + UTM meta).

## Honest status: BLOCKED_EXTERNAL for live transport
- Adapters are driven by an **injectable `RawSource`** seam; there is **no live HTTP client wired** and no
  credentials in this environment. `healthCheck()` returns `classification: 'FIXTURE_PROVEN'`.
- `markting_store_connections` rows are created only in tests today — there is **no OAuth/credential ingress
  route** that creates a commerce connection in production.
- The incremental-sync engine (`sync.ts`, checkpoints in `markting_commerce_sync_state`) and the HMAC webhook
  verifier (`webhooks.ts`, dedup in `markting_commerce_events`) are built and unit-tested, but **no HTTP route
  mounts the webhook receiver and no background runner executes syncs**.

## How commerce appears in the control plane
`listCanonicalConnections` surfaces any existing `markting_store_connections` rows as `category: commerce`
with `liveTransportImplemented: false`, status derived from the store status + consecutive sync errors
(CONNECTED / SYNC_FAILED / PROVIDER_ERROR / DISCONNECTED). The admin fleet view counts commerce stores and
failing syncs. The tenant Connection Center shows the store with the honest BLOCKED_EXTERNAL note.

## To make commerce live (out of scope here)
1. A live HTTP transport implementing `RawSource` per platform + credential ingress (OAuth for Shopify;
   merchant creds/API keys for Salla/Zid/Woo/custom), stored via the existing crypto.
2. A mounted webhook route calling `ingestWebhook` with the stored `signing_secret_ref`.
3. A background runner invoking `runIncrementalSync` on a schedule (none exists in-repo).
