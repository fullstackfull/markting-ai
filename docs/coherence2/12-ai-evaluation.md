# 12 — AI Evaluation Harness — DONE (framework + deterministic suite) / BLOCKED_EXTERNAL (live model)

`lib/markting/orchestrator/eval/harness.ts` is a real evaluation framework with modes MODEL_DISABLED /
LOCAL_FALLBACK / LIVE_MODEL and a rubric: factual inclusion, non-hallucination (prohibited factors),
prioritization (next action), grounding (every factor carries data-trust), causal restraint (unresolved
present), review-only safety, and trust capping. `eval/scenarios.ts` holds 20 cross-domain graded
scenarios (media + commerce + creative together) — the human-reviewable reference set, extensible toward
the 50-scenario target. `test/ai-eval-harness.test.ts` runs the suite (all pass) and proves a LIVE_MODEL
run stays DETERMINISTIC_ONLY (no faking). **Live-model execution is BLOCKED_EXTERNAL** (no governed
credentials); the identical rubric grades a narrated answer once a model is wired. Scenario count is 20,
not the aspirational 50 — stated honestly; the harness is the deliverable, the dataset is extensible.
