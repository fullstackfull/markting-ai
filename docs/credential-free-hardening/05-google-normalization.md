# 05 — Google normalization prep + search/social diagnostics (items 8, 9, 10)

`lib/markting/ops/google-normalization-prep.ts`, `lib/markting/ops/search-diagnostics-prep.ts`,
`lib/markting/ops/social-diagnostics-prep.ts` + `test/normalization-prep.test.ts`,
`test/search-social-prep.test.ts`.

## Google normalization (item 8)

Same shape as Meta, grounded in `packages/google/src/provider.ts` `BASE_METRIC_FIELDS`.
`GOOGLE_FIELD_MAP` maps documented GAQL fields (`metrics.cost_micros`, impressions, clicks, conversions,
`conversions_value`) → canonical keys. `normalizeGoogleSearchRow` converts `cost_micros` → currency units
(÷1e6) as a **same-currency unit conversion, explicitly not FX** — currency is carried only from the
documented `customer.currencyCode` and never converted across currencies. `GOOGLE_SEARCH_CONTRACT` backs
drift detection. The live GAQL call is BLOCKED_EXTERNAL.

## Search diagnostics (item 9) — REVIEW_ONLY

Pure diagnostics over canonical search rows: `wastedSpendCandidates`, `lowQualityScoreSignals`,
`searchTermNegativeCandidates`, `runSearchDiagnostics`. Each returns a `SearchSuggestion`
`{kind, entityId, finding, evidence, recommendedAction, confidence, reviewOnly:true}`.

**Auto-apply is unrepresentable by construction**: `reviewOnly` is the literal type `true`;
`recommendedAction` is a plain descriptive string (no executable handle); a compile-time `NoAutoApply<T>`
guard resolves any shape carrying `apply`/`execute`/`mutate`/`write`/`reviewOnly:false` to `never`; and
`SEARCH_DIAGNOSTICS_MODE = 'REVIEW_ONLY'`. No function returns anything but suggestions.

## Social diagnostics (item 10) — multi-signal fatigue

`detectFatigueSignals` tests three **independent** signals off three different metrics
(FREQUENCY_RISING, CTR_DECLINING, CPM_RISING). `classifyCreativeHealth`: FATIGUE requires
`>= MIN_SIGNALS_FOR_FATIGUE` (2) independent signals; exactly one signal → WATCH (never FATIGUE); zero →
HEALTHY. Findings are advisory (`reviewOnly:true`). Pure.
