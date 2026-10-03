# 03 — Provider Commerce Matrix

Documented capabilities (`connector.ts#COMMERCE_CAPABILITIES`) and semantic differences
(`PROVIDER_SEMANTIC_NOTES`). COGS is treated as absent by default everywhere (merchants configure cost
out of band) except where a platform genuinely exposes a cost field.

| Capability | Salla | Zid | Shopify | WooCommerce | Custom |
|---|---|---|---|---|---|
| orders | ✓ | ✓ | ✓ | ✓ | ✓ |
| refunds | ✓ | ✓ | ✓ | ✓ | ✗ |
| products | ✓ | ✓ | ✓ | ✓ | ✗ |
| cogs | ✗ | ✗ | ✓¹ | ✗ | ✗ |
| acquisitionRef (UTM/click) | ✗ | ✗ | ✓ | ✓ | ✗ |
| customerIdentity | ✓ | ✓ | ✓ | ✓ | ✗ |
| inventory | ✓ | ✓ | ✓ | ✓ | ✗ |
| webhooks | ✓ | ✓ | ✓ | ✓ | ✗ |
| incremental cursor | ✓ | ✓ | ✓ | ✓ | ✗ |

¹ Shopify may expose `InventoryItem.cost` where the merchant populated it — still treated as
merchant-config trust, never platform-authoritative.

## Semantic differences encoded by the normalizers (never cross-assumed)

- **Salla:** totals typically **tax-inclusive** — the tax line is read explicitly, not assumed
  exclusive; refunds are distinct from cancellations; there is no Shopify-style `financial_status`.
- **Zid:** its own order-status codes — mapped **independently** of Salla; currency is per-store;
  refunds are distinct from cancellations.
- **Shopify:** `subtotal_price / total_tax / total_discounts / current_total_price` are discrete;
  `financial_status` and `fulfillment_status` are **independent** (a paid order can be unfulfilled);
  refunds are a separate resource summed from refund records.
- **WooCommerce:** plugins add arbitrary meta — **unknown meta stays in `raw`, never a trusted canonical
  fact**; order status is extensible (only known statuses mapped); refunds are **negative-line records**
  summed by absolute value (a refund never exceeds the order — enforced by data-quality).
- **Custom (generic):** requires an explicit, validated, signed schema with identity + currency +
  timestamps; **arbitrary JSON is rejected** (missing required fields throw) — never accepted into
  business truth.

Live classification for every provider in this environment: **FIXTURE_PROVEN** (typed boundary +
fixtures); live OAuth/transport is **BLOCKED_EXTERNAL**.
