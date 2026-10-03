# 09 — Data-Science Corrections — DONE (four material P1s)

Per the rule "no analytical engine becomes user-facing until its known mathematical P1s are repaired",
four material flaws from `docs/reassessment/08-data-science.md` were corrected (not a rewrite). All
affected existing suites stayed green; `test/data-science-corrections.test.ts` adds 12 cases.

1. **Sample-size unit mismatch (P1 #1) — `optimize/sample.ts`.** `requiredConversionsPerArm` returned
   the per-arm VISITOR count `16/(mde²·p)` and compared it to conversions — ~1/p too strict. Now returns
   CONVERSIONS per arm ≈ `16·(1−p)/mde_rel²` with relative-MDE semantics documented. Example: p=0.02,
   mde=10% → ~1568 (was 80000). The explicit floor and `MIN_SAMPLE_FOR_CONFIDENCE` still apply.

2. **Anomaly baseline + seasonality (P1 #2/#3) — `intelligence/anomaly.ts`.** Replaced the global
   in-sample baseline (which included the point being judged → trend false-positives + spike masking)
   with a trailing-window / leave-one-out baseline that EXCLUDES the point (the docstring's "rolling
   baseline", now true). Day-of-week adjustment requires anchored `weekdays` (no more `index % 7`
   guessing on possibly-gapped series); with no weekdays, no seasonal adjustment is applied.

3. **Reconciliation thresholds (P1 #4) — `commerce/reconciliation.ts`.** Flat 15%/35% thresholds ignored
   order count. Added `sampleSufficiency` (LOW below 25 orders — annotates without changing the state)
   and low-sample threshold widening for n < 5 (a 3-order account at ~45% is EXPECTED_VARIANCE, not
   MATERIAL). The normal n ≥ 5 classification is unchanged (existing eval behaviour preserved).

4. **Pacing early-period projection (P2 #9) — `intelligence/pacing.ts`.** The straight-line projection
   exploded early in a period (`spendToDate / tiny-fraction`). Added a min-elapsed guard (< 10% elapsed
   or < 1 day → projection withheld, `projectedOverUnderPct` omitted, `projectedSpend` = floor, explicit
   reason). Corrected the false "timezone-aware" docstring (day math is the caller's responsibility).

## Remaining (lower priority, NOT_STARTED this pass)

Forecast i.i.d. variance band (P2 #6), response-curve stability (P2 #7), value-weighted ROAS confidence
floor (P2 #9/#10), same-window CAC/MER cohorting (P1 #5), discount-convention provenance (P1 #6). These
feed engines not yet surfaced as dedicated pages; they are the math slices to complete alongside those
surfaces (per the sequencing rule).
