# 04 — Campaign Health (2D)

`intelligence/health.ts`. Health is reported as explicit **dimensions**, never a fake single 0–100
score. Each dimension is judged deterministically from an evidence input; the overall state is the
**worst material** dimension, or `INSUFFICIENT_DATA` when the data cannot support a judgement.

Dimensions: `delivery, efficiency, conversion_quality, pacing, data_sufficiency, creative_freshness,
tracking_quality, attribution_confidence`.

States: `HEALTHY, WATCH, ATTENTION, CRITICAL, INSUFFICIENT_DATA`.

Rules that matter:

- **Low spend is never poor performance.** It maps to `data_sufficiency = INSUFFICIENT_DATA`, not
  CRITICAL. Efficiency/conversion-quality are not even judged without sufficient data.
- **Tracking break is CRITICAL.** Spend with zero conversions sets `tracking_quality = CRITICAL`.
- **No target → efficiency is WATCH, not a false pass.** Without a configured target the system says
  "baseline only" rather than claiming the campaign meets an objective.
- **Overall = worst material dimension.** A single CRITICAL dimension makes the campaign CRITICAL; if
  every judged dimension is INSUFFICIENT_DATA, the overall is INSUFFICIENT_DATA.

Health feeds the Opportunity Center (2T) and Morning Brief (2U) and is computed inside
`analyzeAccount` from the account aggregate + pacing + target gap + tracking signal.
