# 06 — Scale, query budgets & performance (Programs 17–20)

## What is in place (and tested)
- **In-memory orchestrator scale** — `test/scale.test.ts`: 10,000 campaigns through
  `buildScaling + buildPacing + buildScenario` in < 5000 ms, and 10,000 creatives → exactly 10,000 rows
  in < 5000 ms. The composed section path is O(n), no quadratic blow-up.
- **Query/cost budgets (the bounded gatherer)** — `lib/markting/intelligence/context.ts`:
  `ContextBudget` (default `maxCampaigns: 10`, `maxRows: 50`). `buildAnalysisContext` ranks campaigns by
  spend-movement contribution, keeps the top N, collapses the rest into `summarizedCampaignCount`, and
  flags `truncated` — so account size cannot create unbounded model/prompt cost. Pure, read-only;
  verified data-only by `phase2-injection.test.ts`.
- **AI rolling quota** — `lib/markting/ai-gateway.ts`: a per-window budget
  (`windowMs 24h, maxRequests 1000, maxCostMicros 50_000_000`) checked before each call; exceeding it
  fails closed with `POLICY_VIOLATION`. Every call is metered into the usage ledger.
- **Characterization harness** — `test/phase2-performance.test.ts` profiles `analyzeAccount +
  buildMorningBrief` at 10/100/1000/10000 campaigns (gated behind `RUN_PERF=1`), asserting the output is
  not O(N²).

## Honest performance report
- The scale guarantee is **< 5 s at 10,000 entities on the in-memory orchestrator path**, asserted in CI
  on every run.
- p50/p95/query-count instrumentation is **not** collected as a formal benchmark in this program; the
  characterization harness logs timings but asserts only shape/linearity.

## The outstanding item (stated, not hidden)
The **DB read paths are explicitly untested for scale** — `scale.test.ts:8-10` names the known hot
spots (`effectivenessRows` full scans, `upsertOrders` N+1). A DB-path scale refactor + real query-count
budgets on those paths is the outstanding Program 17/20 work; it was **not** done here because it is a
backend refactor without a new user-facing workflow and carries real regression risk against the live
DB suites. Gate "major DB-path scale fixes" is therefore **PARTIAL**: the bounded gatherer + AI budget
+ in-memory scale are done and tested; the DB query-path refactor is deferred and named.
