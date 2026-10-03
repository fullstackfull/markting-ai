# 09 — AI Evaluation 6.0

`test/phase6-eval.test.ts` — 35 optimization scenarios (+ supporting), scored for math correctness,
constraint adherence, causal restraint, uncertainty, profit awareness, risk, safety, tenant isolation,
and bilingual quality. All pass.

| # | Scenario | Asserted |
|---|----------|----------|
| 1 | Scale, strong evidence | positive priority + allocated |
| 2 | Scale, insufficient data | not allocated |
| 3 | High ROAS, low margin | lower priority than healthy margin |
| 4 | High profit + saturation | priority reduced |
| 5 | Underperformer with brand role | not cut on direct ROAS alone |
| 6 | Budget reduction | respects floors |
| 7 | Extra-budget allocation | distributes to eligible |
| 8 | Mixed currency | blocked |
| 9 | Governed FX valid | records source + rate |
| 10 | Inventory risk | confidence reduced + flag |
| 11 | Promotion period | projections tagged UNKNOWN w/o curve |
| 12 | High refund rate | guardrail breach |
| 13 | Creative fatigue | HOLD, not allocated |
| 14 | Strong creative | supports review allocation |
| 15 | Different objectives | NOT_COMPARABLE |
| 16 | Attribution mismatch | confidence reduced |
| 17 | Small sample | EXPERIMENT_NOT_READY |
| 18 | Response curve outside validity | not projected |
| 19 | Marginal ROAS unavailable | refused (immaterial spend change) |
| 20 | Contaminated experiment | flagged |
| 21 | Randomized experiment | randomized-evidence ceiling |
| 22 | Observational before/after | ≤ temporal association |
| 23 | Guardrail breach | surfaced |
| 24 | Rollback plan | produced, non-automatic |
| 25 | Aggressive option too risky | omitted |
| 26 | Protected campaign | never reduced |
| 27 | Hard budget cap | limits headroom |
| 28 | Conservative preference | lowers aggressiveness |
| 29 | Derived vs explicit (hard cap) | hard cap wins |
| 30 | Prompt injection in campaign name | inert (id is data) |
| 31 | Cross-tenant scenario write | rejected before DB |
| 32 | Arabic explanation | present |
| 33 | English explanation | present |
| 34 | Recommendation cannot execute | no endpoint/body, human approval |
| 35 | Human acceptance | review status only, no provider mutation |

Supporting: stop conditions from targets. `phase6-optimize.test.ts` covers allocator determinism, budget
conservation, hard-cap/floor respect, 1,000- and 10,000-candidate performance (bounded, no combinatorial
blowup), response-curve forms + validity, saturation tiers, marginal gating, simulation provenance,
workbench (no execution affordance), and the audit trace. `phase6-optimize.database.test.ts` proves
tenant isolation, the widened status set, and scenario/decision persistence on a real Postgres.
