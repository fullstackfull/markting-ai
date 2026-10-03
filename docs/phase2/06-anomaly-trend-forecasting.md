# 06 — Anomaly, Trend & Forecasting (2H / 2I / 2J)

## Anomaly (2H) — `intelligence/anomaly.ts`

Beyond a single MAD rule. A point is flagged only when it is BOTH statistically extreme (robust
modified z-score vs a rolling baseline, mean/σ fallback when MAD=0) AND materially large (percentage +
absolute thresholds). **Day-of-week seasonality** is removed when ≥2 weeks of history exist, so a
normal weekend dip is not an anomaly. Classes: `INFO / WATCH / ACTIONABLE / CRITICAL`; only genuinely
abnormal, business-relevant points reach CRITICAL. **Alert-storm control:** only the single most
extreme flagged point keeps its escalated class; the rest of the batch are capped at WATCH, so one
incident is one alert, not many.

## Trend (2I) — `intelligence/trend.ts`

Distinguishes `NOISE / SHORT_TERM_MOVE / PERSISTENT_TREND / STRUCTURAL_SHIFT`. One bad day never
becomes a trend: classification needs a configurable minimum window and directional consistency across
the recent window, measured against a robust baseline (median + MAD). A move must clear both the MAD
spread AND a small relative floor (≈3% of the baseline), so a ~1% wiggle reads as noise. A large,
sustained level shift is `STRUCTURAL_SHIFT`.

## Forecasting (2J) — `intelligence/forecast.ts`

Conservative, transparent methods only — no ML. `forecastCumulative` (straight-line run-rate for
spend/conversions/revenue) and `forecastCpa` (trailing moving average of the daily ratio, dropping
zero-conversion days). **Every forecast carries its method, window, an uncertainty band [low, high],
a confidence (LOW/MEDIUM/HIGH from input dispersion), and explicit limitations** — a point estimate is
never presented as a promise.
