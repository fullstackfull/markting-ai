# 07 — Live Commerce Read (Stage 10) — BLOCKED_EXTERNAL / OPTIONAL

No live/sandbox merchant credentials exist here. The Phase-5 connectors (Salla/Zid/Shopify/WooCommerce/
generic) normalize orders/refunds/products/currency into merchant revenue → MER/CAC/profitability, and
are FIXTURE_PROVEN with per-provider semantics; PII is excluded from LLM context by construction
(`commerce/pii.ts` analytics-safe projection — tested). Live connection (real orders/refunds, webhooks)
is HELD until a sandbox/real merchant is connected. Commerce is OPTIONAL for first revenue if the
product is sold as ad-intelligence only.
