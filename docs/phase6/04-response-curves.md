# 04 — Response Curves, Saturation & Marginal Metrics (6M/6N/6O)

`optimize/response-curve.ts`. NO fake ML.

## Response curve (6M)

`fitResponseCurve` estimates a simple, auditable spend→conversions relationship ONLY with ≥ 4 distinct
spend levels and ≥ 30 total conversions; otherwise `INSUFFICIENT_EVIDENCE`. It classifies the form
(`LOCAL_LINEAR / DIMINISHING_RETURNS / MONOTONIC_BOUNDED`), records the evidence window, sample size,
fit quality, limitations, and a **validity range** = the observed spend span. `withinValidity` gates
projection; the simulator refuses to extrapolate beyond it (returns UNKNOWN, never a guess).

## Saturation (6N)

`detectSaturation` combines weak signals (spend rising, marginal conversions weakening, CPA worsening,
ROAS deteriorating, frequency rising, reach growth slowing). `STRONG_SATURATION_SIGNAL` requires the
core pair (weakening marginal conversions + worsening CPA) plus a corroborator; otherwise
`SATURATION_SIGNAL` or `NO_SIGNAL`. Never `SATURATION_PROVEN`.

## Marginal metrics (6O)

`marginalMetrics` computes marginal CPA/ROAS between two windows ONLY with a material spend change
(≥ 15% by default) and enough conversions; it refuses (with a reason) when the spend change is
immaterial or conversions are thin — never from two arbitrary points.
