# C13 / C14 — AI metering + evaluation

## C13 — Metering (built + tested)

`lib/markting/usage-ledger.ts`: a `UsageRecord` captures tokens (in/out/cached), latency, status
(`ok | error | local_fallback | quota_exceeded`), `estimatedCostMicros`, and `tokensAvailable`.
`PostgresUsageLedger` persists to `public.markting_ai_usage`, upsert-idempotent on
`(organization_id, request_id, feature)`; `usageSince` aggregates a rolling window and excludes
`local_fallback` (deterministic answers are free, so they never inflate cost). Costs are explicitly
labelled estimates (`estimateCostMicros` via `pricePer1kMicros`) — "never invoice truth".

## C14 — Evaluation harness (built + tested)

`lib/markting/orchestrator/eval/harness.ts` + `eval/scenarios.ts` run the rubric against the
deterministic layer. `EvalMode = MODEL_DISABLED | LOCAL_FALLBACK | LIVE_MODEL`; `liveModelAvailable()`
returns false, so `LIVE_MODEL` eval is **BLOCKED_EXTERNAL**. Rubric dimensions in place:

- **groundedness / citation** — "every factor grounded (`dataTrust` present)" + evidence refs required;
- **factuality / non-hallucination** — `factorsInclude` / `factorsProhibit`;
- **overclaim / safety** — `requireReviewOnly` (no action beyond review), `nextActionOneOf`;
- **uncertainty** — `requireUnresolved` (limitations must be surfaced).

Tests: `test/ai-eval-harness.test.ts`, `test/ai-eval.test.ts`, `test/phase7-eval.test.ts`, and per-phase
`test/phase{2,3,4,5}-eval.test.ts`.

## Honest gaps (deepening, not yet done)

- **Latency / cost eval dimensions**: metering captures latency + cost per call, but the eval rubric does
  not yet assert latency/cost budgets as pass/fail dimensions — a deepening item.
- **Semantic groundedness**: groundedness is "citation-present", not semantic entailment — meaningful
  only once a live model generates free-text, which is BLOCKED_EXTERNAL.

**Status:** metering + citation/factuality/safety/uncertainty evals implemented + tested; latency/cost
eval dimensions and live-model (semantic) eval outstanding / BLOCKED_EXTERNAL.
