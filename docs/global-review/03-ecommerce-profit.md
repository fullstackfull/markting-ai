# Global Review 03 — Ecommerce / Profit Media-Buyer Lens

Reviewer role: ecommerce profit media buyer (optimizing for contribution profit, not vanity ROAS).
Date: 2026-10-04. Base app: `platform/apps/cloud`. All claims grounded in code paths cited below.
Independent audit; verified the prior note about connectors myself.

---

## 1. What I actually traced (evidence)

### Commerce profit engine — `platform/apps/cloud/lib/markting/commerce/*`
A genuinely sophisticated, well-documented library (2,441 LOC across 17 files). Highlights:

- **Revenue** (`revenue.ts`): `computeRevenue` works under an EXPLICIT `RevenueBasis` (which stages
  count, tax/shipping inclusion, refund/discount deduction). Default is conservative net
  (`net_paid_excl_tax_excl_shipping`, lines 15–22). Refund-aware; critically it **prefers ONE refund
  source per order** (records else order-level total, never both — lines 68–70, 116–124) so refunds
  are not double-counted. Mixed currency is never blended (lines 54–63, 79).
- **COGS / Margin / Contribution** (`profit.ts`): COGS is **never inferred from price** — unknown cost
  stays `null`, never 0 (lines 1–10, 27–30, 84–86). `orderCogs` returns `null` if ANY line cost is
  unknown (lines 34–46). Contribution definition is **org-configurable** (`ContributionConfig`, lines
  48–62). `computeMargin` returns a typed `notComputableReason` instead of a fake number (lines 75–86).
- **Break-even ROAS** (`profit.ts` 109–130): `1 / contribution-margin-fraction`, requires a margin that
  EXCLUDES ad spend, else `BREAK_EVEN_UNKNOWN`. Methodology string carried through.
- **MER / CAC / LTV** (`metrics.ts`): `computeMER` **refuses platform-attributed conversion value**
  (`source !== 'merchant'` → notComputableReason, line 54); same-currency only; carries basis, ad-spend
  scope, window, trust tier — never a bare ratio. `blendedCAC` refuses a number when < 50% of orders
  have reliable identity (lines 92–107). LTV is strictly `OBSERVED_LTV`, never predicted (lines 110–163).
- **Reconciliation** (`reconciliation.ts`): platform-vs-merchant variance classified
  ALIGNED / EXPECTED_VARIANCE / MATERIAL_VARIANCE / NOT_COMPARABLE / INSUFFICIENT_DATA, with
  **sample-sufficiency** gating (thresholds widen below 5 orders, LOW flag below 25 — lines 24–89) and
  a list of ten legitimate variance explanations (lines 42–46). Explicitly states a discrepancy is
  "not fraud" (surfaces.ts 178). Cross-currency guard refuses to sum without a **governed** FX rate
  carrying source + timestamp (lines 128–142).
- **Attribution** (`reconciliation.ts` 104–126): conservative — hashed provider click id =
  DIRECTLY_TAGGED; UTM/referrer = MERCHANT_LAST_TOUCH (explicitly "not deterministic"); no fake
  multi-touch precision.
- **Product/SKU intelligence** (`products.ts`): per-SKU revenue/profit/refund, COGS → UNKNOWN if any
  unit cost missing (line 47), promo-vs-baseline partition (88–98), and creative×commerce profit
  **gated on DIRECTLY_TAGGED attribution** — refuses a creative-profit number on weak attribution
  (118–147).
- **Data quality** (`data-quality.ts`): fails CLOSED on duplicate orders, refund>order, negative
  totals, future timestamps, impossible quantities, mixed-currency lines; excludes bad orders from
  trusted aggregates.
- **Diagnostics** (`diagnostics.ts`): exactly the profit-vs-vanity disagreements a profit buyer needs —
  `PLATFORM_ROAS_EXCEEDS_MERCHANT`, `REFUNDS_ERODE_NET_REVENUE`, `ROAS_UP_MARGIN_DOWN`,
  `REVENUE_UP_PROFIT_DOWN`, `CPA_STABLE_AOV_FELL`, `BELOW_BREAK_EVEN`. Recommendations are
  **review-only**, `requiresHumanApproval: true`, never auto-change budget (94–141).
- **Surfaces** (`surfaces.ts`): keeps AD-PLATFORM VIEW and MERCHANT VIEW strictly separate, omits any
  tile lacking trusted inputs (with an `omittedReason`), bilingual EN/AR. "Ask Commerce" answers
  actual-revenue / MER / platform-vs-store / product-profit / refund-impact / CAC / break-even and
  always cites a basis, refusing numbers when inputs are missing.
- **Persistence** (`store.ts`): tenant-scoped Postgres, idempotent order upsert, insert-only cost
  history, webhook HMAC **fails closed** on a missing signing secret (168–175).
- **Ratio safety** (`lib/markting/orchestrator/ratios.ts`): every displayed ratio degrades to a typed
  UNKNOWN (ZERO_DENOMINATOR / MISSING_INPUT / MIXED_CURRENCY / INCOMPATIBLE_PERIOD) rather than 0/NaN/∞.

### Tests
`npx vitest run` on the three commerce suites: **29 passed, 7 skipped**. The only failure is
`phase5-commerce.database.test.ts` → `ECONNREFUSED 127.0.0.1:55322` (no local Postgres) — an
environment gap, not a code defect. The pure-logic suites pass.

---

## 2. CRITICAL FINDINGS — why this cannot drive a real profit decision today

These are the findings a profit media buyer must hear before trusting a number.

### F1 — Connectors cannot fetch live data (BLOCKED_EXTERNAL). CONFIRMED.
`providers.ts` connectors (Salla/Zid/Shopify/WooCommerce/custom) are driven by an **injectable
`RawSource`** (lines 22–28) described in-code as "the seam a live HTTP client would fill later." There
is **no HTTP client anywhere in `lib/markting/commerce/`** (grep for fetch/axios/got returned nothing
but comments). `healthCheck` hardcodes `classification: 'FIXTURE_PROVEN'` with the literal string
"live transport BLOCKED_EXTERNAL (no credentials)" (providers.ts 46). The only `RawSource`
implementations are fixtures in `test/`. The prior-audit note is accurate: connectors are built,
read-only, unit-tested, transport blocked.

### F2 — The dashboard is wired to SYNTHETIC or EMPTY, never to the live commerce store. (New finding.)
`grep "markting/commerce" app/` returns **nothing** — no page or API route imports the commerce lib.
`app/dashboard/commerce/page.tsx` renders `loadSection(tenant, 'COMMERCE_PROFIT')`, which resolves
through `lib/cloud/intelligence.ts` → `serviceForMode()`:
`isDemoMode() ? demoGatherer : emptyGatherer` (intelligence.ts 47). So:
- **Live deployment** → `emptyGatherer` → `COMMERCE: 'NOT_CONNECTED'` (demo-gatherer.ts 20–25). The
  real customer sees nothing.
- **Demo** → `demoGatherer` + synthetic `seed.ts` commerce (seed.ts 186–188, `adSpendMinor: 3600000,
  cogsMinor: 4200000, merchantRevenueMinor: 9800000`). `buildCommerce` (sections.ts 197–211) DOES run
  the real engine (computeMER/computeMargin/reconcile/breakEvenRoas) — but over **synthetic seed data**.

No gatherer reads the Postgres commerce store into the dashboard: `listOrderRows`, `loadCostBook`,
`computeRevenue` have **no live caller** (grep confirms only `store.ts`/`revenue.ts` reference them).
`query-budgets.ts` even documents the INTENDED live reads ('orders window', 'refunds', 'cost book')
— i.e., the live read path is designed but not implemented. The sync engine (`sync.ts`) that would
populate those tables also depends on the blocked connectors (F1). **The chain
connector → Postgres → revenue/margin/MER → dashboard is broken at both ends.**

### F3 — Ad spend into MER/CAC is not a verified live join.
`computeMER` correctly refuses platform-sourced *revenue*, but the **ad-spend** operand it divides by
comes, in the only wired path, from the same synthetic `seed.ts` (`adSpendMinor`). There is no live,
reconciled ad-spend → merchant-revenue join in production. MER's integrity rule is sound in code; the
data feeding it is not live.

### F4 — Financial-risk assessment (the core question).
The classic wrong decision — *"platform says 4x ROAS, scale it"* while refunds + COGS mean you lose
money — is the exact scenario this system is architected to PREVENT, and the logic does so well
(F2's `REVENUE_UP_PROFIT_DOWN`, `ROAS_UP_MARGIN_DOWN`, `PLATFORM_ROAS_EXCEEDS_MERCHANT`, break-even
gating, platform/merchant view separation). I found **no logic path that would output a financially
misleading number as if trusted** — the opposite: it aggressively returns UNKNOWN. The residual
financial risk is therefore not bad math but **(a) non-operability** — it cannot show a real
merchant's profitability today — and **(b) synthetic-vs-real confusion**, which is mitigated by the
posture guard (`guardAnswerPosture`, intelligence.ts 16–23), trust tiers, and NOT_CONNECTED states.

### F5 — Scope limits a profit buyer will hit.
Predictive LTV is deferred (observed only). Inventory is advisory, minimal (`inventoryRisk`, a simple
threshold) with no live feed. No subscription/MRR, no marketplace-fee or shipping-cost ingestion
beyond order fields, no multi-currency P&L roll-up (correctly refused rather than faked). Blended MER
scope strings ('all_channels') exist but there is no evidence the blend is assembled from verified
per-channel live spend.

---

## 3. Strengths (what is genuinely ahead of market)

1. **Profit-first epistemics.** COGS never inferred; margin/MER/CAC/LTV return typed
   `notComputableReason` instead of fake numbers. This is more disciplined than most commercial
   profit dashboards (e.g., TrueProfit/BeProfit routinely estimate COGS).
2. **Platform vs merchant separation is first-class**, not a footnote — the single most important
   guardrail against the vanity-ROAS trap, and it is enforced end-to-end in the surface layer.
3. **Reconciliation with statistical honesty** — sample-sufficiency gating and widened small-sample
   thresholds prevent false MATERIAL alarms; explicitly frames variance as expected, not fraud.
4. **Attribution conservatism** — DIRECTLY_TAGGED vs last-touch distinction, creative-level profit
   withheld on weak attribution. No fake multi-touch.
5. **Fail-closed everywhere** — data-quality exclusion, governed-FX requirement, webhook HMAC refusal,
   ratio-safety primitive, and a defense-in-depth posture guard against synthetic data leaking live.

## 4. Gaps (what blocks daily use)

1. **No live commerce data path** (F1 + F2) — connectors blocked AND no live gatherer wiring.
2. **Dashboard shows synthetic or NOT_CONNECTED** — a real merchant cannot see their own numbers.
3. **Ad-spend join not live/verified** (F3) — MER/CAC run on seed spend.
4. **Predictive LTV, inventory depth, marketplace/shipping-cost ingestion** absent (F5).
5. **DB-backed tests unrunnable here** (no Postgres) — the persistence layer is unproven in this env.

---

## 5. Scores (0–5)

| Dimension | Score | Basis |
|---|---|---|
| Net revenue accounting (basis, refund-aware) | 4 | Excellent logic (`revenue.ts`); not live |
| Refunds intelligence | 4 | `refundIntelligence`, single-source rule |
| COGS / contribution margin | 4 | Never-inferred discipline, org-configurable |
| MER | 4 | Refuses platform revenue; spend not live (F3) |
| CAC | 4 | Identity-gated; honest refusal |
| LTV | 3 | Observed only; predictive deferred |
| Inventory | 2 | Advisory threshold only, no feed |
| Attribution uncertainty | 4 | Conservative, click-id gated |
| Reconciliation | 5 | Best-in-class sample/variance handling |
| Blended channel performance | 4 | Strong comparability gate (`cross-channel.ts`) |
| Commerce integration (live) | 1 | Connectors blocked; no live wiring (F1/F2) |
| Product-level intelligence | 4 | Per-SKU profit/refund, promo split, gated |
| "Why declined / what next" | 3 | Logic answers it; runs on synthetic data, review-only |
| Data quality / safety | 5 | Fail-closed, posture-guarded, ratio-safe |

---

## 6. Maturity verdict

**WOULD_PILOT.**

The profit-intelligence *thinking* in this codebase is excellent and, in several places (reconciliation
honesty, never-infer-COGS, platform/merchant separation), ahead of shipping commercial tools. As a
**library**, it is mature and well-tested. But as a **product a profit-focused media buyer could use to
decide where to put money today, it is not operational**: it cannot ingest a real store's orders
(F1), cannot show a real merchant's profitability on the dashboard (F2), and divides MER by synthetic
ad spend (F3). Can it tell you *why profitability declined and what to do next?* — **Yes in design and
on synthetic data; no on your real account today.** I would pilot it the moment live connector
transport + the Postgres→dashboard gatherer land, because the hard part (getting the profit epistemics
right) is already done. Until then it is a demo of correct thinking, not a decision tool.
