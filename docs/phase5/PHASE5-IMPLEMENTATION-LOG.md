# Phase 5 — Implementation Log

Commerce Connectors, Business Truth, Profit Intelligence, MER/CAC/LTV & Merchant-Side Attribution.
**READ / ANALYZE / RECOMMEND only** — no commerce writes, no ad-provider writes, no budget/price/
inventory automation. Built on Phase-4 exit `10ec080`, branch `claude/amazing-heisenberg-0unnak`.

## Modules (`lib/markting/commerce/`)

| Area | Module |
|------|--------|
| 5A canonical model + integer money | `model.ts` |
| 5B connector contract + capability/semantics matrix | `connector.ts` |
| 5C–5G Salla/Zid/Shopify/WooCommerce/generic connectors | `providers.ts` |
| commerce data trust | `trust.ts` |
| data quality (fail-closed) | `data-quality.ts` |
| 5J/5Q/5R revenue + refunds + status | `revenue.ts` |
| 5K/5L/5Y COGS + margin + contribution + break-even | `profit.ts` |
| 5M/5N/5O/5P MER + CAC + customer identity + observed LTV | `metrics.ts` |
| 5S/5T/5U/5V reconciliation + attribution + FX guard | `reconciliation.ts` |
| 5W/5X profit-aware diagnostics + review-only recommendations | `diagnostics.ts` |
| 5Z target profitability config | `targets.ts` |
| product/SKU intelligence + inventory risk + promotions + creative×commerce | `products.ts` |
| PII redaction / analytics-safe projection | `pii.ts` |
| 5H durable sync engine | `sync.ts` |
| 5I webhook ingestion | `webhooks.ts` |
| profit brief / ask / profitability + reconciliation dashboards | `surfaces.ts` |
| tenant-scoped persistence (+ sync/webhook ports) | `store.ts` |

## Migration

`20261009000000_phase5_commerce.sql` — 9 forward-only tenant-scoped tables (`markting_store_connections`,
`markting_orders`, `markting_order_lines`, `markting_refunds`, `markting_products`,
`markting_product_costs`, `markting_commerce_sync_state`, `markting_commerce_events`,
`markting_profitability_config`) with FKs, indexes, grants, and the RLS + revoke house convention.
Following the Phase-4 lesson, **UPDATE is granted on every table whose writer upserts with
`ON CONFLICT DO UPDATE`** (orders/lines also get DELETE for idempotent line replacement).

## Tests

- `test/phase5-eval.test.ts` — Evaluation 5.0, 30 scenarios (+ supporting).
- `test/phase5-commerce.test.ts` — connectors, sync, webhooks, products/SKU, recommendations.
- `test/phase5-commerce.database.test.ts` — DB-gated tenant isolation, idempotent sync, webhook dedup,
  cost book, config history.

Full non-DB cloud suite: **575 passed** after Phase 5.

## Safety posture

Analysis only. Connectors never write. Recommendations are typed review labels (no endpoint/body,
`requiresHumanApproval: true`), never an auto budget/price/inventory change. The registry read-only gate
and Phase-0 human-approved write path are unchanged. Live commerce OAuth/transport and a governed FX
layer are BLOCKED_EXTERNAL in this environment; nothing is faked.
