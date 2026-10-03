# 09 — Scale — PARTIAL

- **Orchestrator path — benchmarked (DONE).** `test/scale.test.ts` builds 100 / 1,000 / 10,000 campaigns
  and 10,000 creatives and times the real section builders + allocation; the surfaced orchestrator path
  is O(n) and completes well under bound (no DB, no full scans).
- **DB read/ingest paths — NOT_STARTED.** The reassessment's P0/P1 scale issues (`effectivenessRows`
  three-table in-JS join, `upsertOrders` N+1, silent 5000-row truncation, missing indexes, queue
  fairness) live in paths NOT on the surfaced orchestrator path (the surfaces use the orchestrator over
  demo/empty gatherers, not those heavy stores). They remain a release-blocker for a future live,
  large-account gatherer and are recorded as outstanding; no synthetic-DB load test was run this pass.
