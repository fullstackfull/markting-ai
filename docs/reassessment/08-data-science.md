# 08 — Data-Science & Statistical-Method Assessment

**Lens:** quant / data scientist. **Method:** static reading of the analytics/optimize/commerce math @
`affdecc`. Tags: `VERIFIED_CODE` / `PARTIAL` / `MISSING`.

## General finding

The codebase is unusually disciplined about currency-mixing, ratio-of-sums vs sums-of-ratios,
division-by-zero, and evidence gating. Most **plumbing** is correct. The failures are in the
**statistical methods themselves** and in **hard-coded thresholds that do not scale with sample size /
baseline rate / timezone.** Those are what break on real accounts. Because none of this math is reachable
from the product (see 01/05), these are latent correctness bugs that detonate the moment a surface is
wired — not live incidents today.

## Top 10 data-science gaps

1. **[P1] Sample-size formula returns a VISITOR count but is compared against CONVERSIONS.**
   `optimize/sample.ts` computes `ceil(16/(mde²·p))` and `assessSample` compares it to
   `conversionsPerArm`. The rule-of-16 yields trials per arm, not conversions; correct conversions ≈
   `16/mde²`. Worked: `p=0.02, mde=10%` → demands 80,000 conversions/arm vs the correct ~1,600 — ~50×
   too strict (scales as 1/p), and conflates relative vs absolute MDE. Fails safe (experiments never
   reach READY) but the "significance" claim is wrong. `VERIFIED_CODE`.
2. **[P1] Anomaly "rolling baseline" is actually a global in-sample baseline** that includes the point
   being scored. `intelligence/anomaly.ts` (and `analysis.ts:anomalyDetection`) compute one global
   median/MAD over the whole series. Under trend it flags the newest points (false positives); multiple
   spikes inflate MAD and mask each other; no windowing. Docstring says "rolling"; code is not.
   `VERIFIED_CODE`/`PARTIAL`.
3. **[P1] Day-of-week adjustment keys off `index % 7` with no date anchoring.** `anomaly.ts` assumes
   index 0 is a fixed weekday and the series is gap-free daily. Any missing day or non-daily cadence
   puts the 7 buckets out of phase and can **manufacture** anomalies. The [0.25,4] clamp limits blast
   radius, not the phase error. `VERIFIED_CODE`.
4. **[P1] Reconciliation variance thresholds are flat constants not scaled by order count.**
   `commerce/reconciliation.ts` uses expected 15% / material 35% with the only sample guard being
   `orderCount===0`. A 3-order account at 40% gap is classified identically to a 10,000-order account —
   false "material variance" on small/new accounts, false "aligned" on large. Should widen with 1/√n.
   `VERIFIED_CODE`.
5. **[P1] No conversion-delay / cohorting in CAC, MER, attribution alignment.** `commerce/metrics.ts`
   `blendedCAC = spend(window)/newCustomers(window)` and `MER = revenue(window)/spend(window)` assume
   spend and its conversions fall in the same window. Real purchase lag (days–weeks) + late refunds
   bias CAC/MER on growing/shrinking accounts; no spend-to-acquisition cohorting exists. `PARTIAL`.
6. **[P1] Revenue gross-sales reconstruction hard-codes a platform-specific discount convention.**
   `commerce/revenue.ts` adds `discountTotal` back to `subtotal` ("subtotal is already net of discount
   in most platforms"). For a platform where subtotal is pre-discount this double-counts the discount.
   Convention is assumed globally, not detected per-platform or carried as provenance. `VERIFIED_CODE`.
7. **[P2] Response-curve marginal / diminishing-returns from consecutive finite differences on
   observational, spend-sorted points.** `optimize/response-curve.ts` sorts points by spend (destroying
   temporal order), takes pairwise ΔC/ΔS with no smoothing/regression/CI, and declares diminishing at a
   magic 0.7. The conservative last-segment slope and `withinValidity` refusal-to-extrapolate are good
   guards, but the slope being guarded is itself unstable and non-causal. `VERIFIED_CODE`.
8. **[P2] Forecast uncertainty band assumes i.i.d. daily values (√horizon).** `intelligence/forecast.ts`
   uses `band = dailyStd·√h` over a ≤7-day window. Marketing series are autocorrelated/weekly-seasonal,
   so true cumulative variance grows faster than h and the band is **too narrow** (false precision). The
   point estimate is a flat run-rate with no trend/seasonality (honestly labelled). `forecastCpa`
   correctly averages daily ratios. `VERIFIED_CODE`.
9. **[P2] Pacing projection unstable early in the period; module not actually timezone-aware.**
   `intelligence/pacing.ts` `projectedSpend = spendToDate/elapsed` with `elapsed` floored at 1e-9 — at
   0.1 day into a 30-day month it projects a wildly inflated total; no min-elapsed guard. Docstring
   claims "timezone-aware" but there is **no timezone logic**; `partialDay` only appends a reason
   string. `VERIFIED_CODE`/`MISSING`.
10. **[P2] Universal `MIN_SAMPLE_FOR_CONFIDENCE = 30` applied identically to count-ratios and
    value-weighted ratios.** `data-trust.ts` and consumers use one constant of 30 "conversions"
    everywhere. 30 is reasonable for a count mean, but **ROAS is value-weighted** — variance driven by
    order-value dispersion, not count. 31 orders with 2 outliers clears the floor and can reach
    READY/HIGH confidence. Phase-acknowledged placeholder for a real power engine. `VERIFIED_CODE`.

## Additional assumptions that will break in real accounts

- `observedLTV` mixes net and gross across orders depending on field availability → inconsistent LTV
  basis (`metrics.ts`).
- Zero-denominator ratios reported as 0, not undefined (`analysis.ts`: `roas = spend ? value/spend :
  0`) — revenue with zero recorded spend reads ROAS=0 (low-risk but misleading in rollups).

## What is actually sound (so the reader can calibrate)

Ratio-of-sums never average-of-ratios; consistent, strong cross-currency discipline (governed-FX-only);
robust statistics (median+MAD) preferred over mean/σ; COGS never inferred from price (stays UNKNOWN);
refund double-count avoidance; causal honesty (before/after never labelled randomized); scaling requires
a beaten known target not volume alone; fatigue CPM hard-gate; pervasive INSUFFICIENT_EVIDENCE gating.

## Net

The deterministic analytics are **correct in their plumbing and honest in their uncertainty labelling**,
but several **core statistical methods are naive or mis-specified** (sample-size units, in-sample
anomaly baseline, unanchored seasonality, unscaled variance bands, same-window CAC/MER, i.i.d. forecast
variance). These must be fixed *before* the engines are wired to a surface, or the product will surface
confidently-wrong numbers. None is a safety risk today because none is reachable.
