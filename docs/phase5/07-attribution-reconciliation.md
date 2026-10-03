# 07 — Attribution & Reconciliation (5S/5T/5U/5V/5W/5X)

`reconciliation.ts`, `diagnostics.ts`.

## Platform vs merchant reconciliation (5S)

`reconcile` compares ad-platform attributed revenue with merchant recorded revenue for the same window
and classifies the gap: `ALIGNED`, `EXPECTED_VARIANCE`, `MATERIAL_VARIANCE`, `NOT_COMPARABLE`
(different currency — no governed FX), `INSUFFICIENT_DATA`. We never expect equality; the possible
explanations (attribution windows, cross-device, view-through, duplicate events, refunds, payment
failures, timezone/currency differences, consent/tracking loss, platform modelling) are surfaced. A
discrepancy is **never** presented as fraud or a tracking error automatically.

## Attribution references & views (5T/5U)

Merchant-side signals captured: UTM (source/medium/campaign/content/term), hashed provider click ids,
landing page, referrer. `attributionView` classifies an order conservatively: `DIRECTLY_TAGGED` (hashed
click id present — strongest merchant-side signal), `MERCHANT_LAST_TOUCH` (UTM/referrer only — **not
deterministic**), `UNATTRIBUTED`, `UNKNOWN`. UTM is never treated as deterministic attribution, and
advanced multi-touch precision is deliberately deferred.

## Cross-currency guard (5V)

`compareMoney` compares same-currency directly; different currency is `NOT_COMPARABLE` unless a
**governed** `FxRate` (with source + timestamp) is explicitly supplied. A model-supplied FX rate is
never accepted.

## Profit-aware diagnostics & recommendations (5W/5X)

`diagnoseCommerce` surfaces exactly where ad-platform metrics and merchant truth disagree:
`PLATFORM_ROAS_EXCEEDS_MERCHANT`, `REFUNDS_ERODE_NET_REVENUE`, `ROAS_UP_MARGIN_DOWN`,
`REVENUE_UP_PROFIT_DOWN`, `CPA_STABLE_AOV_FELL`, `BELOW_BREAK_EVEN`, `COMMERCE_DATA_GAPS`. Platform
metrics never dominate merchant truth. Recommendations (`generateCommerceRecommendations`) are
review-only categories — `PROFITABILITY_REVIEW, MER_REVIEW, REFUND_RATE_REVIEW, CAC_REVIEW,
MARGIN_REVIEW, ATTRIBUTION_RECONCILIATION_REVIEW, COMMERCE_DATA_QUALITY_REVIEW` — each a typed label
with no endpoint/body, `requiresHumanApproval: true`, and never an auto budget change.

## Creative × commerce linkage

`products.ts#creativeCommerceLinks` links creative → orders → revenue → refund → profit ONLY where
attribution is `DIRECTLY_TAGGED`; with weak attribution it refuses a profitability number and returns a
caveat. COGS-unknown orders also withhold profit.
