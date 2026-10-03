# 03 — Creative Performance, Lifecycle, Rating, Contribution (4C/4D/4O/4Q)

`creative/performance.ts`. Deterministic, evidence-gated, currency-safe.

## Performance shares (4C)
`creativeShares()` — spend / impression / click / conversion share across a comparable set.

## Rating (4O) — `rateCreative()`
States: `PROMISING / STRONG_PERFORMER / AVERAGE / UNDERPERFORMING / INSUFFICIENT_DATA`. Judged WITHIN a
comparable cohort (caller supplies the cohort median CPA/ROAS among comparable creatives).
- **A low-spend / thin-conversion / low-tier creative is `INSUFFICIENT_DATA`, never a "loser".**
- Efficiency is scored against the cohort median (±15% bands); a small-sample "winner" cannot be
  STRONG_PERFORMER because it fails the conversion floor first.

## Lifecycle (4D) — `creativeLifecycle()`
States: `NEW / LEARNING / MATURE / DECLINING / DORMANT / RETIRED`, from EVIDENCE (first-seen + spend +
impressions + conversions + recent delivery + CTR trend), **not age alone**. `DECLINING` requires a
persistent CTR down-trend (the Phase-2 trend engine), not a single bad day. Inactive → RETIRED; no
recent delivery → DORMANT.

## Comparability (4P) — `creativeComparability()`
`COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE`. Hard blockers → NOT_COMPARABLE: different
currency, different campaign objective. Soft differences (date window, country/audience, attribution
basis) → PARTIALLY_COMPARABLE. Creatives are never compared blindly.

## Contribution (4Q) — `creativeContribution()`
Which creatives explain a campaign metric movement — and crucially whether a **CPM (media-cost) change**
explains it instead of creative performance. `attribution`:
`CREATIVE_DRIVEN / MEDIA_COST_DRIVEN / MIXED / INSUFFICIENT_EVIDENCE`. When CPM moved materially
(≥30% → media-cost-driven; ≥15% → mixed) the engine does **not** blame the creative, and says so.
Avoids Simpson's-paradox blind spots by requiring a comparable cohort upstream before rating.
