# Phase 6 — Implementation Log

Experimentation, Budget Allocation, Optimization Intelligence & Decision Simulation. **Analysis /
review only — no autonomous execution, no approval bypass.** Built on Phase-5 exit `d19dbe9`, branch
`claude/amazing-heisenberg-0unnak`.

## Modules (`lib/markting/optimize/`)

| Area | Module |
|------|--------|
| 6A-6D canonical experiment, types, hypothesis, study-type/causal-ceiling | `experiment-model.ts` |
| 6E deterministic sample sufficiency | `sample.ts` |
| 6F guardrail metrics | `guardrails.ts` |
| 6G experiment contamination/validity (reuses Phase-3) | `contamination.ts` |
| 6H deterministic scenario simulator (provenance-tagged) | `simulate.ts` |
| 6M/6N/6O response curves, saturation, marginal metrics | `response-curve.ts` |
| 6K/6L hard + soft constraints | `constraints.ts` |
| 6I/6J/6P-6U budget allocation (greedy, constraint/profit/creative/inventory/attribution-aware) | `allocation.ts` |
| 6V/6W/6X/6Y/6Z risk, reversibility, options, stop conditions, rollback | `decision.ts` |
| governed FX (cross-currency blocked otherwise) | `fx.ts` |
| review-only optimization recommendation categories | `recommendations.ts` |
| experiment outcome engine (result vs recommendation result) | `outcome.ts` |
| optimization audit trace | `trace.ts` |
| decision workbench, scenario comparison, experiment calendar | `workbench.ts` |
| tenant-scoped persistence | `store.ts` |

## Migration

`20261010000000_phase6_optimization.sql` — extends `markting_experiments` forward-only (new columns +
widened status check) and adds `markting_experiment_assignments`, `markting_experiment_observations`,
`markting_optimization_scenarios`, `markting_scenario_constraints`, `markting_scenario_decisions`. RLS +
revoke; UPDATE granted on every `ON CONFLICT DO UPDATE` writer.

## Optimization engine choice

Deterministic GREEDY marginal-value allocation (documented in `03-budget-allocation.md`): the problem
shape (per-candidate caps/floors + one shared budget + a monotone priority) is solved well and auditably
by greedy in O(N log N + steps); LP/convex/ML was not justified and is deferred.

## Tests

`phase6-eval` (35 scenarios), `phase6-optimize` (determinism + budget conservation + hard-cap/floor
respect + 1k/10k performance + curves + simulation provenance + workbench + trace),
`phase6-optimize.database` (DB-gated tenant isolation + widened status + scenario/decision persistence).
Full non-DB suite 630 passed.

## Safety posture

No autonomous write. Recommendations are review-only labels; scenario decisions record review status
only; the workbench routes all execution through the Phase-0 approval path. The LLM performs no hidden
optimization math.
