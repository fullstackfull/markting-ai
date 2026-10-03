# 01 — Experiment Model (6A–6G)

`optimize/experiment-model.ts`, `sample.ts`, `guardrails.ts`, `contamination.ts`.

## Canonical experiment (6A)

`Experiment` carries experiment/org/workspace ids, a structured hypothesis, provider/account/entity
scope, explicit control + treatment arms, primary/secondary/guardrail metrics, dates, status,
assignment method, observation window, sample requirement, confidence method, contamination flags,
outcome, conclusion, and a recommendation linkage. Statuses: `DRAFT, READY_FOR_REVIEW,
APPROVED_FOR_LAUNCH, RUNNING, PAUSED, COMPLETED, INVALIDATED, INCONCLUSIVE, CANCELLED`. Nothing launches
automatically.

## Types (6B)

`BUDGET_INCREASE/DECREASE, CREATIVE_TEST, HOOK_TEST, ANGLE_TEST, LANDING_PAGE_TEST (observational
planning only), AUDIENCE_TEST, PLACEMENT_TEST, BID_STRATEGY_REVIEW, CAMPAIGN_STRUCTURE_REVIEW`.
`feasibleExperimentTypes` only offers types the available data + platform capabilities support.

## Hypothesis (6C)

Every experiment has a structured, non-vague hypothesis: statement, metric, expected direction, scope,
assumptions, known risks, and minimum evidence required.

## Control / treatment + study type (6D)

Explicit control/treatment definitions. The study type is classified honestly —
`RANDOMIZED / PLATFORM_EXPERIMENT / QUASI_EXPERIMENTAL / BEFORE_AFTER / OBSERVATIONAL` — and a
before/after is never dressed up as randomized. `causalCeiling(studyType)` caps the strongest claim:
before/after ≤ `TEMPORAL_ASSOCIATION`, observational ≤ `OBSERVATIONAL_ASSOCIATION`, quasi ≤
`QUASI_EXPERIMENTAL_EVIDENCE`, randomized/platform → `RANDOMIZED_EVIDENCE`.

## Sample sufficiency (6E)

`assessSample` is DETERMINISTIC — the LLM never invents a sample size. A transparent approximation
(`16/(mde²·p)`, floored at the 30-observation minimum) sets the required conversions/arm; insufficient
conversions/spend/impressions/duration → `EXPERIMENT_NOT_READY` with explicit reasons. It is documented
as an approximation, not an exact power analysis.

## Guardrails (6F)

`CPA_CEILING, ROAS_FLOOR, BUDGET_CEILING, CONTRIBUTION_MARGIN_FLOOR, REFUND_RATE_CEILING,
FREQUENCY_CEILING, SPEND_EXPOSURE_CEILING, TRACKING_HEALTH_REQUIRED`. Guardrails constrain
recommendation quality + define stop conditions; they never authorize execution. `evaluateGuardrails`
reports breaches for a hypothetical/observed value.

## Contamination (6G)

`classifyExperimentValidity` reuses the Phase-3 contamination vocabulary →
`VALID / CONTAMINATED / INVALIDATED / INCONCLUSIVE`. A tracking incident or attribution change
INVALIDATES (the measurement basis itself moved); any other confounder CONTAMINATES; a thin/incomplete
window is INCONCLUSIVE. The outcome engine refuses to read a non-VALID experiment as a result.
