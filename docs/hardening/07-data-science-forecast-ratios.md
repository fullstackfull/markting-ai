# 07 — Data-science P2 review, forecast honesty, ratio safety (Programs 21–23)

## Data-science P2 review (Program 21)
The Wave-2 corrections (sample-size as conversions-per-arm not visitor count; pacing early-period
projection guard; anomaly/reconciliation guards) remain in place and tested in
`test/data-science-corrections.test.ts`. No new P2 regressions were found in the composed engines; the
orchestrator golden cases (`test/orchestrator-golden-cases.test.ts`) pin the cross-domain composition.

## Forecast honesty (Program 22) — `73f2728`
The `Forecast` type (`lib/markting/intelligence/forecast.ts`) already carries, and the forecast surface
now **shows**, all of: `method` (`run_rate` / `trailing_moving_average` — transparent methods only, no
hidden model), input `windowDays`, `horizonDays`, the uncertainty band `[low, high]`, `confidence`, and
an explicit `limitations[]` list (e.g. "short history; estimate is weak"). The UI states: *"Transparent
method only — the band is the uncertainty, not a promise."* No ML, no point-estimate-as-promise.

## Ratio safety (Program 23) — `807fb3f`
Two layers, one rule set — every ratio degrades to an explicit UNKNOWN (with a reason), never a silent
0/Infinity/NaN:

- **Money-basis ratios** (MER, blended CAC, contribution margin, observed LTV) enforce it in
  `lib/markting/commerce/metrics.ts` + `commerce/*` via typed `notComputableReason`: zero/unknown ad
  spend, non-merchant-sourced revenue, mixed currency, insufficient customer identity, missing COGS
  → UNKNOWN.
- **Display/count ratios** (ROAS, CTR, CVR, CPA, refund rate) use the shared primitive
  `lib/markting/orchestrator/ratios.ts` (`safeRatio` + typed reasons `ZERO_DENOMINATOR` /
  `MISSING_INPUT` / `MIXED_CURRENCY` / `INCOMPATIBLE_PERIOD`). A **real zero numerator stays a known 0**
  (0 purchases over 1000 impressions is CVR 0, a fact — not missing data). The most specific reason is
  reported first (currency mismatch before zero denominator).

Evidence: `test/ratios.test.ts`, `test/data-science-corrections.test.ts`, `test/phase5-commerce.test.ts`.
