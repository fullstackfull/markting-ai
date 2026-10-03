# 05 — Budget Pacing, Scaling & Downscale (2E / 2F / 2G / 2K)

## Pacing (2E) — `intelligence/pacing.ts`

Deterministic, currency-safe, timezone-aware. Status: `ON_TRACK / OVERPACING / UNDERPACING /
NOT_EVALUABLE`. Carries a **straight-line projection** (clearly labelled `method: 'straight_line'`,
never a certainty) and a partial-day flag. Mixed-currency spend is `NOT_EVALUABLE`.

The critical professional distinction: **underpacing is not a scale signal.** An underpacing campaign
returns `interpretation: 'DELIVERY_OR_OPPORTUNITY_REVIEW'` — a prompt to check whether delivery is
constrained (auction/targeting/creative) OR whether there is genuine budget room, never an instruction
to raise budget. Supports daily/monthly/period budgets and month-length/elapsed inputs from the caller.

## Scaling readiness (2F) — `intelligence/scaling.ts#evaluateScalingReadiness`

No automatic percentages. States: `NOT_EVALUABLE / NOT_READY / POTENTIALLY_READY /
READY_FOR_HUMAN_REVIEW`. Requires sufficient spend + conversions, stability, fresh trustworthy data,
reliable attribution, and (where configured) beating target. Even when everything supports it, the
output is only `READY_FOR_HUMAN_REVIEW` — the recommendation engine turns this into a
`BUDGET_REVIEW/REVIEW_BUDGET_SCALE`, which a human reviews on the Phase-0 path. No suggested percentage
is produced in Phase 2.

## Downscale / pause candidacy (2G) — `evaluateDownscaleCandidacy`

States: `OBSERVE / REVIEW / STRONG_REVIEW_CANDIDATE`. Never pauses on one simplistic rule; weighs
missing target, worsening trend, zero-conversion spend, and (reducing the score) strategic importance.
**Low spend is explicitly OBSERVE, never a cut.** A thin observation window or sample caps the verdict
below `STRONG_REVIEW_CANDIDATE`.

## Targets / goals (2K) — `intelligence/targets.ts`

Targets come only from configured business context (provenance KNOWN/CONFIGURED/DERIVED). Missing →
`UNKNOWN`, never invented. `evaluateTargetGap` distinguishes performance-vs-baseline from
performance-vs-objective and returns `TARGET_BEAT/ON/MISS/UNKNOWN` with the delta.
