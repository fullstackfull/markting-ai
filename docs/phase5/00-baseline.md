# Phase 5 — Baseline

Branch `claude/amazing-heisenberg-0unnak`. Phase 4 exit `10ec080` (Phase 3 `299460c`, Phase 2 `48982b9`,
Phase 1 `3e91494`, Phase 0 `e6fbd0c`).

Phase 5 adds the layer MARKTING-AI was missing: **merchant business truth**. The platform previously
understood ad-platform data → analysis → diagnosis → recommendation → memory → outcome → creative
intelligence. Phase 5 adds COMMERCE DATA → real business revenue → refunds → COGS → gross margin →
contribution margin → MER → CAC → observed-LTV → profit-aware media-buying analysis.

## The central objective

Stop treating ad-platform-reported conversion value as business truth. The system now distinguishes
**PLATFORM ATTRIBUTED PERFORMANCE** (what Meta/TikTok/Google report) from **MERCHANT BUSINESS
PERFORMANCE** (what the store actually recorded) and never silently substitutes one for the other.

## ABSOLUTE SAFETY RULE (held throughout)

Phase 5 is **READ / ANALYZE / RECOMMEND only**. It does not alter store orders, products, pricing,
inventory, refunds, or campaigns; it does not write to ad providers; it does not automate budget. All
commerce connectors are READ-ONLY. All Phase-0 write controls remain intact. Recommendations are typed
review labels with no endpoint/body and `requiresHumanApproval: true`.

## Environment reality (verified)

| Capability | State | Consequence |
|---|---|---|
| GitHub Actions runner | AVAILABLE | CI incl. the real-Postgres DB lane runs; Phase-5 tables get DB-isolation tests. **RUNTIME_PROVEN** where it applies. |
| Live Salla/Zid/Shopify/WooCommerce credentials | NOT PRESENT | connectors are driven by an injectable `RawSource` (the seam a live HTTP client fills) and classified **FIXTURE_PROVEN**; live transport **BLOCKED_EXTERNAL**; no fabricated live proof. |
| Governed FX layer | NOT PRESENT | cross-currency figures are **NOT_COMPARABLE** (never blended); a model-supplied FX rate is never accepted. |
| Local Supabase/Postgres | DOWN locally | DB-gated suites run only in the CI `cloud-db` lane. |

Classification tags: **RUNTIME_PROVEN** (CI DB lane), **SANDBOX_PROVEN**, **FIXTURE_PROVEN** (proven
against the typed connector boundary + fixtures), **BLOCKED_EXTERNAL** (needs infra/creds absent here).

## Built on (not rebuilt)

Phase-0/1 canonical Money (integer minor units), data-trust framework, engine-context (server-derived
tenant), Phase-3 memory (targets/promotions/refund incidents as structured facts), Phase-2 currency-
aware aggregate, Phase-4 creative intelligence (creative×commerce linkage). Deterministic-first,
bilingual (en/ar), evidence/comparability-safe, causal-restraint — all carried forward.

## New persistent entities (one forward-only migration, RLS + revoke, tenant-scoped)

`markting_store_connections`, `markting_orders`, `markting_order_lines`, `markting_refunds`,
`markting_products`, `markting_product_costs`, `markting_commerce_sync_state`,
`markting_commerce_events`, `markting_profitability_config`.
