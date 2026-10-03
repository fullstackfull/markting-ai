# 10 — Expert Red-Team

An independent panel (e-commerce CFO/finance, performance marketer, Salla/Zid/Shopify/WooCommerce
integration experts, attribution scientist, data engineer, privacy/security engineer, SaaS architect)
reviewed the commerce system read-only. It confirmed the core invariants HOLD and found two concrete
bugs plus four narrower gaps — all fixed with regression tests before exit.

## Findings and dispositions

| # | Finding | Rank | Disposition |
|---|---------|------|-------------|
| 1 | Refund **double-count**: `computeRevenue` and the data-quality check summed BOTH order-level `refundedTotal` AND the refund records for the same refund → net understated, and a false `REFUND_EXCEEDS_ORDER` could drop a whole valid order | **BROKEN** | **FIXED** — both sites now PREFER ONE source (`refundsByOrder.get(id) ?? refundedTotal`), matching the existing `products.ts` pattern (`revenue.ts`, `data-quality.ts`). Regression sets BOTH sources. |
| 2 | Webhook signing-secret **fail-open**: `resolveConnection` returned `''` when the secret ref was null → HMAC verified with an empty (public) key → forgeable webhook | **BROKEN** | **FIXED** — `dereferenceSigningSecret` fails closed; a null/empty ref makes `resolveConnection` return null → ingest returns `UNKNOWN_CONNECTION`. DB-gated regression forges with an empty key and is refused. |
| 3 | `refundIntelligence` ignored order-level `refundedTotal` → refunds silently 0 when only that source exists | **PARTIAL** | **FIXED** — folds the order-level fallback with the same prefer-one rule (`revenue.ts`). |
| 4 | `computeMER` did not enforce merchant-sourced revenue → platform-attributed value could masquerade as MER | **PARTIAL** | **FIXED** — `source` now defaults to merchant and platform-sourced revenue is refused with a reason; `merFromObservation` carries a RevenueObservation's merchant source through (`metrics.ts`). |
| 5 | Salla tax-inclusive `sub_total` taken verbatim (unlike Zid) → an "excl-tax" net could still include tax | **PARTIAL** | **FIXED** — Salla subtotal is derived tax/shipping-exclusive from the total (like Zid), so the excl-tax basis is honest (`providers.ts`). |
| 6 | `redactPii`/`containsPii` matched EXACT keys → missed `_billing_email`, nested `customer.email`, `payment_method` | **PARTIAL (latent)** | **FIXED** — segment/phrase matching catches prefixed/nested PII without false-positiving legitimate analytics keys (`paymentStatus`, `customerClass`). `toAnalyticsSafe` remains the only model path. |

## Invariants verified as HOLDING (not assumed)

- **Cross-tenant isolation:** org is server-stamped in sync, asserted on write (rejected before DB),
  resolved from the connection (not the payload) for webhooks, and the customer pseudo-id is a per-org
  HMAC (no cross-tenant collision as an identity claim). No cross-store order-id guess path.
- **DB grants/RLS:** every `ON CONFLICT DO UPDATE` writer has UPDATE; insert-only / `DO NOTHING` tables
  correctly get only `select, insert`; order_lines has DELETE for the resync replace. No grant gap
  (the Phase-4 lesson held), validated green on the real-Postgres CI lane.
- **COGS never 0:** `orderCogs` returns null unless every line's cost is known; `computeMargin` refuses
  when COGS is null; cost is never inferred from price.
- **Sync:** incremental, bounded (`MAX_PAGES_PER_RUN`), idempotent upsert, checkpoint preserved on
  error before dead-lettering; bounded backfill. No full-history re-fetch.
- **Reconciliation / attribution / currency:** variance framed as expected (never fraud); UTM is
  last-touch (not deterministic); creative profit withheld without `DIRECTLY_TAGGED`; currencies never
  blended and a model-supplied FX rate never accepted.

The panel's report is model output treated as findings to verify, not authority; each fix was validated
against the suite (`test/phase5-redteam-fixes.test.ts` + a DB-gated webhook-fail-closed case).
