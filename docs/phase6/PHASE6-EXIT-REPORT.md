# Phase 6 — Exit Report

Experimentation, Budget Allocation, Optimization Intelligence & Decision Simulation. **Analysis /
review only — no autonomous execution, no approval bypass, autonomous optimization DISABLED.**

The 41-item final response:

1. **Branch** — `claude/amazing-heisenberg-0unnak`.
2. **HEAD** — `15400e3` + this docs-only commit (built on Phase-5 exit `d19dbe9`).
3. **Commits** — `9cd2ebe` (engine + migration + tests), `38a3fa7` (docs 00-09 + log),
   `15400e3` (red-team fixes + docs 10), and this exit-report commit.
4. **Migrations** — `20261010000000_phase6_optimization.sql`: extends `markting_experiments`
   forward-only (new columns + widened status check) and adds `markting_experiment_assignments`,
   `markting_experiment_observations`, `markting_optimization_scenarios`, `markting_scenario_constraints`,
   `markting_scenario_decisions`. RLS + revoke; UPDATE granted on every `ON CONFLICT DO UPDATE` writer.
5. **Experiment model** — canonical `Experiment` (9 statuses, structured hypothesis, explicit
   control/treatment, sample requirement, guardrails, observation window, contamination, outcome,
   conclusion, recommendation linkage); honest study-type + causal-ceiling.
6. **Experiment types** — budget ±, creative/hook/angle, landing-page (observational planning only),
   audience, placement, bid-strategy review, campaign-structure review; gated by `feasibleExperimentTypes`.
7. **Sample-sufficiency methodology** — deterministic; `16/(mde²·p)` conservative approximation floored
   at the 30-observation minimum; insufficient → `EXPERIMENT_NOT_READY`. Never LLM-invented.
8. **Guardrails** — CPA ceiling, ROAS floor, budget ceiling, contribution-margin floor, refund-rate
   ceiling, frequency ceiling, spend-exposure ceiling, tracking-health required. Constrain quality +
   define stop conditions; never authorize execution.
9. **Contamination rules** — reuse Phase-3 vocab → VALID / CONTAMINATED / INVALIDATED / INCONCLUSIVE
   (tracking/attribution change → INVALIDATED).
10. **Budget allocation engine** — `allocateExtra` / `reduceBudget`, review-only MOVES; profit-aware,
    role-aware, saturation/fatigue/inventory/attribution-aware; aggregate org-cap enforced.
11. **Optimization algorithm choice** — DETERMINISTIC GREEDY marginal-value allocation, O(N log N +
    steps), bounded iteration guard; documented why greedy (not LP/convex/ML) fits the problem shape.
12. **Response-curve methodology** — simple auditable fits (local-linear / diminishing / monotonic),
    ≥4 spend levels + ≥30 conversions else INSUFFICIENT_EVIDENCE; explicit validity range, no
    extrapolation; diminishing curves expose the conservative local marginal.
13. **Marginal metrics** — marginal CPA/ROAS only with a material (≥15%) spend change + enough
    conversions; refused otherwise (never two arbitrary points).
14. **Profit-aware optimization** — contribution margin / MER prioritized over platform ROAS where
    merchant truth exists; margin/refund guardrails.
15. **Cross-channel comparability** — COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE gates; no fake
    universal ranking; brand/strategic not raided for direct ROAS.
16. **FX status** — governed FX only (source+rate+timestamp); LLM rates never accepted; cross-currency
    **BLOCKED** in this environment (no governed source) — Gate E.
17. **Scenario model** — CURRENT/A/B/C with OBSERVED/ASSUMED/PROJECTED/UNKNOWN provenance tagging;
    projections never guarantees.
18. **Risk / reversibility model** — categorical risk from exposure + reversibility + uncertainty (no
    fake probability); EASILY_REVERSIBLE / REVERSIBLE_WITH_COST / DIFFICULT_TO_REVERSE.
19. **Rollback plans** — explicit restore steps; `automatic: false` (never auto-executed).
20. **Experiment outcome linkage** — reuses Phase-3 outcomes; experiment result vs recommendation
    result distinguished; causal stance clamped to the study ceiling.
21. **UI / workbench** — decision workbench, side-by-side scenario comparison, experiment calendar; no
    execution affordance (`phase0_preview_approval_only`).
22. **Evaluation results** — Evaluation 6.0, 35 scenarios (+ supporting), all pass.
23. **Red-team results** — 1 BROKEN + 5 PARTIAL fixed with regressions; no-execution + cross-tenant
    invariants HOLD (`10-red-team.md`).
24. **Tests** — `phase6-eval` (35), `phase6-optimize` (determinism + perf + curves + simulation +
    workbench + trace), `phase6-redteam-fixes`, `phase6-optimize.database`. Full non-DB suite **636 passed**.
25. **DB-backed tests** — tenant isolation, widened status set, scenario/constraint/decision persistence
    on a real Postgres (CI cloud-db lane). **RUNTIME_PROVEN**.
26. **Performance** — 1,000-candidate allocation < 300ms and 10,000-candidate reduction < 600ms in test;
    greedy O(N log N + steps), no combinatorial explosion; bounded iteration guard.
27. **Live data exercised** — none available (provider/commerce/model creds absent); engine works on
    typed inputs + fixtures. **BLOCKED_EXTERNAL** for live; no fabricated success.
28. **Security findings** — experiment-cut-during-experiment (fixed), aggregate org-cap breach (fixed),
    soft-only brand protection (fixed structural), causal-ceiling clamp (fixed); no execution path, no
    cross-tenant path, no grant/RLS gap.
29. **Blockers** — live provider/commerce/model integrations and a governed FX source are
    BLOCKED_EXTERNAL; controlled human-approved execution is intentionally HELD behind the Phase-0 path.
30. **Gate A — Experiment design:** **READY**.
31. **Gate B — Experiment outcome tracking:** **READY**.
32. **Gate C — Budget allocation intelligence:** **READY**.
33. **Gate D — Profit-aware optimization:** **READY** where merchant truth exists; falls back with
    reduced confidence otherwise.
34. **Gate E — Cross-channel allocation:** **PARTIAL / BLOCKED** — comparability gates ready; cross-
    currency blocked (no governed FX source).
35. **Gate F — Scenario simulation:** **READY**.
36. **Gate G — Human decision workbench:** **READY** (no execution affordance).
37. **Gate H — Controlled human-approved execution:** **HELD** — intentionally not enabled; execution
    remains behind the Phase-0 preview/approval path.
38. **Gate I — Autonomous optimization:** **DISABLED** (by mandate; nothing executes).
39. **Gate J — Production customer:** **NOT READY** — needs a live-connected account with targets,
    merchant truth, and a response-data history; the pipeline is built and DB-proven but unexercised
    against a live customer.
40. **Exact Phase-7 deferrals** — reinforcement learning controlling spend, self-modifying optimization
    policy, automatic budget execution / campaign pause / experiment launch / price / inventory actions,
    autonomous cross-channel fund movement, full multi-touch/causal attribution, calibrated numeric risk
    probabilities, predictive LTV ML, and a live governed FX layer.
41. **Everything still unproven** — live experiment launch + observation end-to-end, response-curve
    accuracy against real spend-response history, allocation quality against a live account, governed
    cross-currency optimization, and controlled human-approved execution through the Phase-0 path. All
    BLOCKED_EXTERNAL / HELD — never fabricated.

## CI

Final green run on HEAD `15400e3`: **run `37131003252`** — **all six lanes SUCCESS** (node, cloud-db
real-Postgres [tenant isolation + widened experiment status + scenario/decision persistence], engine,
upstream drift, infra, dependency + secret scanning). The pre-fix code run `37130429725` (commit
`9cd2ebe`) was also green on all six lanes.

## Safety attestation

No autonomous write capability exists in Phase 6. Recommendations are review-only labels
(`requiresHumanApproval: true`, no endpoint/body); scenario decisions record a human review status only;
rollback is never automatic; the workbench routes all execution through the Phase-0 preview/approval
path. Core decision math is deterministic, reproducible, and fully traced — the LLM performs no hidden
optimization math. Autonomous optimization is DISABLED.
