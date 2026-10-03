# 12 — Browser E2E & AI Evaluation — PARTIAL / NOT_STARTED

## Browser E2E (Program 21) — NOT_STARTED

No Playwright/Cypress harness exists in the repo and none was added this pass (the reassessment confirmed
zero browser E2E). The new surfaces were verified by `next build` (routes compile and are present) and by
unit tests of the service/orchestrator that drive them, **not** by a real browser journey. Adding
Playwright (dependency + seeded-data harness + the 10 named journeys, incl. Arabic/RTL and mobile) is a
substantial remaining increment. The pre-installed Chromium + Playwright browser path in this environment
makes it feasible in a future pass; it was not done here.

## AI evaluation harness (Program 22) — PARTIAL (deterministic composition evals exist)

- **DONE:** a genuine deterministic evaluation of the intelligence composition now exists —
  `test/orchestrator.test.ts`, `test/orchestrator-golden-cases.test.ts` (12 cross-domain cases), and
  `test/assistant-service.test.ts` grade the WHOLE composed result (diagnosis, ranking, next action,
  evidence, trust, review-only guarantee), not single functions. This is the reusable scaffold a model
  eval would plug into.
- **NOT_STARTED:** a live-model eval harness with golden free-text answers, a scored rubric
  (factual/numeric correctness, grounding, hallucination, prioritization, Arabic/English quality), and a
  CI gate. Model execution is `BLOCKED_EXTERNAL` (no credentials); the honest position is that the
  harness scaffold (deterministic) exists and the model-graded layer is outstanding.

## 50-question benchmark (Program 22.1)

Re-scored honestly in `14-benchmark-results.md` — it did **not** reach the 40/50 target; see that doc for
the true number and why.
