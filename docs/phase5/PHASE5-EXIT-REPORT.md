# Phase 5 — Exit Report

Commerce Connectors, Business Truth, Profit Intelligence, MER/CAC/LTV & Merchant-Side Attribution.
**READ / ANALYZE / RECOMMEND only — no commerce writes, no ad-provider writes, no budget/price/
inventory automation.**

The 37-item final response:

1. **Branch** — `claude/amazing-heisenberg-0unnak`.
2. **HEAD** — `34c1843` + this docs-only commit (built on Phase-4 exit `10ec080`).
3. **Commits** — `942fb64` (commerce engine + migration + tests), `7525ddb` (docs 00-09 + log),
   `34c1843` (red-team fixes + docs 10), and this exit-report commit.
4. **Migrations** — `20261009000000_phase5_commerce.sql`: 9 tenant-scoped, FK'd, indexed tables with
   RLS + revoke; UPDATE granted wherever an upsert uses `ON CONFLICT DO UPDATE` (orders/lines also get
   DELETE for idempotent resync). Forward-only.
5. **Commerce canonical model** — `commerce/model.ts`: Store, StoreConnection, Product, Variant, Order,
   OrderLine, CustomerReference (pseudo-id + class + confidence), AcquisitionRef, Refund, Discount,
   CostObservation, RevenueObservation, MarginObservation; integer `CommerceMoney` with currency-safe
   add/sub/mul/sum; explicit payment/fulfillment status + order stage; preserved source ids + `raw`.
6. **Connectors implemented** — unified read-only contract (`connector.ts`) + Salla, Zid, Shopify,
   WooCommerce, and a validated generic connector (`providers.ts`), each normalizing into the canonical
   model with its own documented semantics; none writes.
7. **Live connectors exercised** — against an injectable `RawSource` (the live-client seam) with
   fixtures → **FIXTURE_PROVEN**; live OAuth/transport is **BLOCKED_EXTERNAL** (no credentials). No
   fabricated live proof.
8. **Order/revenue definitions** — strict separation of Gross Sales / Discounts / Refunds / Tax /
   Shipping / Net Revenue under an EXPLICIT `RevenueBasis` (`revenue.ts`); cancelled/failed/unpaid
   excluded unless the basis counts their stage.
9. **Refund treatment** — refund-aware net revenue + `refundIntelligence` (rate by count/value, full
   vs partial, net-after-refunds); a single refund is counted ONCE across the two sources (red-team #1).
10. **COGS sources** — merchant-config / ERP-feed / manual-import with provenance → trust; NEVER
    inferred from price; unknown stays UNKNOWN (`profit.ts`, `trust.ts`).
11. **Margin model** — gross + contribution margin under an org-configurable `ContributionConfig`
    (declares included cost components); refuses with a reason when inputs are missing.
12. **MER definitions** — explicit basis (gross/net/contribution) + ad-spend scope + window + currency
    + trust; merchant-source enforced (platform value refused); never a bare ratio (`metrics.ts`).
13. **CAC foundation** — blended CAC only when customer identity is reliable enough (`KNOWN`/`PARTIAL`/
    `UNKNOWN`); refused otherwise.
14. **LTV foundation** — OBSERVED 30/60/90-day revenue-per-customer, orders/customer, repeat rate, AOV;
    labelled `OBSERVED_LTV`, never `PREDICTED_LTV`.
15. **Attribution reconciliation** — platform-vs-merchant states (ALIGNED/EXPECTED_VARIANCE/
    MATERIAL_VARIANCE/NOT_COMPARABLE/INSUFFICIENT_DATA) with explanations, never implying fraud;
    conservative attribution views (DIRECTLY_TAGGED/PLATFORM_REPORTED/MERCHANT_LAST_TOUCH/UNATTRIBUTED/
    UNKNOWN); UTM is never deterministic.
16. **Product/SKU intelligence** — per-SKU revenue/refund/profit (profit only when COGS known), top
    revenue/profit, high-refund groups; inventory `LOW_INVENTORY_RISK` is advisory only (never pauses
    ads); promotion partitioning keeps sale lifts out of baseline; creative×commerce profit withheld on
    weak attribution.
17. **PII controls** — `toAnalyticsSafe` is the only model-facing order shape (pseudo-id + class, no raw
    identity, no titles, no notes); segment/phrase redaction for raw bags; order notes (injection
    vector) never reach model context; per-org HMAC pseudonymization.
18. **Tenant-isolation proof** — DB-gated: cross-tenant order write rejected before DB; org-scoped
    reads; webhook org server-resolved (payload org ignored); per-org pseudo-ids. **RUNTIME_PROVEN**.
19. **Evaluation results** — Evaluation 5.0, 30 scenarios (+ supporting), all pass.
20. **Red-team results** — 2 BROKEN + 4 PARTIAL fixed with regressions; invariants HOLD (`10-red-team.md`).
21. **Tests** — `phase5-eval` (30), `phase5-commerce` (connectors/sync/webhooks/products/recs),
    `phase5-redteam-fixes`, `phase5-commerce.database` (DB-gated). Full non-DB suite **582 passed**.
22. **DB-backed tests** — tenant isolation, idempotent order upsert, refund scoping, cost-book load,
    sync-checkpoint resume, webhook dedup + fail-closed, config history — on real Postgres (CI cloud-db).
23. **Performance** — sync is bounded (≤ `MAX_PAGES_PER_RUN`) and never re-fetches full history; all
    hot queries are indexed (`orders` by store+date and by customer; `order_lines` by sku; `refunds` by
    order); aggregates are per-batch/bounded; no full-history scan per dashboard request.
24. **Security findings** — webhook signing-secret fail-open (fixed, fail-closed); PII key-match gap
    (fixed, segment/phrase); no PII reaches model context; secrets stored only as opaque refs; HMAC
    verification is timing-safe.
25. **Remaining blockers** — live commerce OAuth/transport (Salla/Zid/Shopify/WooCommerce) and a
    governed FX layer are **BLOCKED_EXTERNAL**; predictive LTV, advanced multi-touch attribution, and
    any automation are deferred by mandate.
26. **Gate A — Commerce canonical model:** **READY** (RUNTIME_PROVEN via CI DB lane).
27. **Gate B — Read-only commerce connectors:** **PARTIAL** — contract + 5 normalizers FIXTURE_PROVEN; live transport **BLOCKED_EXTERNAL**.
28. **Gate C — Merchant revenue truth:** **READY** (explicit basis; platform value never substituted).
29. **Gate D — Refund-aware analysis:** **READY**.
30. **Gate E — COGS / margin intelligence:** **READY** where cost is configured; UNKNOWN otherwise (never faked).
31. **Gate F — MER / CAC / LTV foundation:** **READY** (observed LTV only; predictive deferred).
32. **Gate G — Platform-vs-merchant reconciliation:** **READY**.
33. **Gate H — Profit-aware recommendations:** **READY** (review-only; never auto-budget).
34. **Gate I — Live commerce data:** **BLOCKED_EXTERNAL** (no credentials in this environment).
35. **Gate J — Production customer:** **NOT READY** — needs a live-connected merchant with configured
    COGS + ad-spend feed; the pipeline is built and DB-proven but unexercised against a real store.
36. **Exact Phase-6 deferrals** — autonomous budget allocation / bid changes / campaign pause,
    automatic price or inventory actions, full predictive LTV ML, advanced causal/multi-touch
    attribution, reinforcement learning, self-modifying strategy, and a governed FX layer.
37. **Everything still unproven** — live commerce ingestion end-to-end (OAuth + rate limits +
    pagination against real Salla/Zid/Shopify/WooCommerce), real per-store COGS/margin accuracy, live
    MER/CAC/LTV against a real ad-spend feed, and cross-currency with a governed FX layer. All
    **BLOCKED_EXTERNAL** — never fabricated.

## CI

Final green run on HEAD `34c1843`: **run `37129306417`** — **all six lanes SUCCESS** (node, cloud-db
real-Postgres [incl. the webhook-fail-closed + tenant-isolation DB tests], engine, upstream drift,
infra, dependency + secret scanning). The pre-fix code run `37128676669` (commit `942fb64`) was also
green on all six lanes.

## Safety attestation

No commerce or ad-provider write capability exists in Phase 5. All connectors are read-only.
Recommendations are typed review labels (no endpoint/body, `requiresHumanApproval: true`) and never
auto-change budget, price, or inventory. The Phase-0 human-approved write path and the registry
read-only gate are unchanged. Platform-attributed value is never substituted for merchant revenue; PII
never reaches model context; tenant identity is always server-derived.
