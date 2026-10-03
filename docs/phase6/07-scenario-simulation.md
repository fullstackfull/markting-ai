# 07 — Scenario Simulation, Risk & Decision Options (6H/6V/6W/6X/6Y/6Z)

## Simulator (6H) — `optimize/simulate.ts`

`simulateScenarios` projects CURRENT vs SCENARIO_A/B/C. Every value is TAGGED by provenance —
`OBSERVED` (measured), `ASSUMED` (a stated assumption, e.g. the proposed spend), `PROJECTED` (derived
from a valid response curve within its range; revenue/ROAS projections state the constant-AOV
assumption), or `UNKNOWN` (outside validity / no curve). Projections are never presented as guarantees.

## Risk & reversibility (6V/6W) — `optimize/decision.ts`

`riskAdjust` separates upside, downside, uncertainty, reversibility, and financial exposure into a
CATEGORICAL risk (LOW/MODERATE/HIGH/CRITICAL) — no fabricated probability (calibrated numeric risk is
deferred). `classifyReversibility`: a small daily budget change is `EASILY_REVERSIBLE`; a pause or
experiment launch is `REVERSIBLE_WITH_COST`; a structure change or deletion is `DIFFICULT_TO_REVERSE`.
Reversibility feeds risk.

## Decision options (6X) + stop conditions (6Y) + rollback (6Z)

`buildDecisionOptions` returns Conservative / Balanced / and (only when evidence is strong, uncertainty
is not high, and the change is reversible enough) Aggressive-review options — each with expected
direction, risk, budget impact, guardrails, and stop conditions, and no fabricated lift %.
`defaultStopConditions` derives CPA/ROAS/margin/refund/exposure stops from targets. `rollbackPlan`
produces explicit restore steps and is `automatic: false` — nothing rolls back on its own in Phase 6.

## Trace (`optimize/trace.ts`)

Every allocation exposes inputs, constraints, deterministic calculations, assumptions, outputs,
uncertainty, and evidence, so a user can audit "why did MARKTING recommend this allocation?". The LLM
performs none of this math.
