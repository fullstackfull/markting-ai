# Phase 6 — Baseline

Branch `claude/amazing-heisenberg-0unnak`. Phase 5 exit `d19dbe9` (Phase 4 `10ec080`, Phase 3 `299460c`,
Phase 2 `48982b9`, Phase 1 `3e91494`, Phase 0 `e6fbd0c`).

Phase 6 adds the decision layer: EXPERIMENT DESIGN → DECISION SIMULATION → BUDGET ALLOCATION
INTELLIGENCE → CONSTRAINT-AWARE OPTIMIZATION → SCENARIO COMPARISON → HUMAN-REVIEWABLE ACTION PLANS.
The goal is NOT autonomous execution — it is to understand the options, expected tradeoffs, uncertainty,
business constraints, and how to test decisions safely BEFORE any ad spend changes.

## ABSOLUTE SAFETY RULE (held throughout)

Phase 6 may design experiments, simulate allocations, recommend budget shifts, rank review
opportunities, estimate scenarios, identify constrained-optimization opportunities, and recommend
human-reviewed tests. It must NOT automatically move budget, change bids, pause campaigns, launch
experiments, create campaigns, publish creatives, modify prices, alter inventory/commerce data, or
bypass the Phase-0 preview/approval path. **No autonomous write capability is added.** Recommendations
are typed review labels (`requiresHumanApproval: true`, no endpoint/body); scenario decisions record a
human REVIEW status only. Autonomous optimization is DISABLED (Gate I).

## AI role

The LLM may explain scenarios, summarize rationale, articulate risks, and compare options. It may NOT
perform hidden optimization math — the core decision calculations are deterministic and reproducible,
and every optimization result exposes an audit trace (inputs, constraints, calculations, assumptions,
outputs, uncertainty, evidence).

## Environment reality (verified)

| Capability | State | Consequence |
|---|---|---|
| GitHub Actions runner | AVAILABLE | CI incl. the real-Postgres DB lane runs; Phase-6 tables get DB-isolation tests. **RUNTIME_PROVEN** where it applies. |
| Live provider / commerce / model credentials | NOT PRESENT | optimization works on supplied/typed inputs and fixtures; live transport **BLOCKED_EXTERNAL**; no fabricated success. |
| Governed FX rate source | NOT PRESENT by default | cross-currency allocation stays **BLOCKED** unless a governed registry (source+rate+timestamp) is supplied; a model-supplied rate is never accepted. |
| Local Supabase/Postgres | DOWN locally | DB-gated suites run only in the CI `cloud-db` lane. |

## Built on (not rebuilt)

Phase-3 `markting_experiments` (extended forward-only), outcomes + contamination vocabulary; Phase-2
scaling readiness, cross-channel comparability, risk; Phase-4 creative fatigue; Phase-5 commerce
profit/MER/margin and the review-only recommendation pattern. Deterministic-first, bilingual,
evidence/comparability-safe, causal-restraint — all carried forward.

## New persistence (one forward-only migration, RLS + revoke)

Extends `markting_experiments`; adds `markting_experiment_assignments`,
`markting_experiment_observations`, `markting_optimization_scenarios`, `markting_scenario_constraints`,
`markting_scenario_decisions`.
