# 10 — Observability exporters + trace correlation + health deepening + rate-limit + cost (items 22, 23, 24, 29, 30)

Files: `lib/markting/ops/exporter.ts`, `lib/markting/ops/trace-correlation.ts`, `lib/markting/ops/health.ts`,
`lib/markting/ops/rate-limit-policy.ts`, `lib/markting/ops/cost-budgets.ts` + their tests.

## Exporters (item 22)

Additive on the Phase C.5 export seam. `BatchBuffer<T>` is bounded with a drop-oldest overflow policy
(dropped count tracked) and a `flush(sink)` that routes a batch and clears; it never throws into callers
(a sink failure drops the batch, counted). The metric buffer and a new span buffer are both bounded
(`setMetricBufferLimit`/`setSpanBufferLimit`, `droppedMetrics`/`droppedSpans`). `PrometheusTextExporter`
gained deterministic histogram rendering (sorted buckets, `+Inf`, `_sum`, `_count`) alongside
counters/gauges; a `StatsdTextExporter` renders DogStatsD lines as a pure string (no socket).
`OpenTelemetryExporter` remains a **BLOCKED_EXTERNAL** buffering stub — no OTLP client.

## Trace correlation (item 23)

`trace-correlation.ts` is a pure, deterministic trace-context model: `createRootContext`/`childContext`
over an injected `IdFactory`, `startSpan`/`endSpan` producing `observability.TraceSpan` (attributes passed
through `redactLog` on open and close), a tenant-aware `correlationId()`, and `correlate(spans)` that
stitches spans into a tree and exposes the end-to-end **critical path** + `criticalPathMs`. `Tracer` /
`traceGovernedWrite()` trace the `TRACE_STAGES` pipeline with one child span per stage.

## Health deepening (item 24)

`computeHealth` gained optional probe signals — queue oldest-job age, worker heartbeat staleness, provider
reauth-required count, webhook signature-failure rate, AI-gateway breaker state — each banding to
DEGRADED/UNAVAILABLE. Each component is the worst of its sub-signals; a component is UNKNOWN only when all
its sub-signals are absent (**fail honest** preserved). Reasons stay operator-safe (no infra detail/secrets).

## Rate-limit policy (item 29)

`rate-limit-policy.ts`: a pure token-bucket engine (`decide` → `{allow, retryAfterMs?, remaining}`,
compatible with the executor's RATE_LIMITED path) plus a fixed/sliding window variant, over an injected
clock + counter store (in-memory fake). Scopes: GLOBAL and per-`(organizationId, provider)`
(org-qualified so tenants never collide); `decideScoped` applies most-restrictive-wins with peek-then-commit
so one scope's rejection does not burn another's tokens. Conservative DOCUMENTATION_DERIVED defaults per ad
provider + commerce connector. The Postgres counter store is a BLOCKED_EXTERNAL stub.

## Cost budgets (item 30)

`cost-budgets.ts`: micros-denominated per-tenant + global budgets aligned with `ai_cost_micros`/
`tenant_usage`. `recordAndCheck(spendMicros)` → `{state: OK|WARN|BLOCKED, spent, remaining, pct, period,
hardStop}` with **admission control** — a spend that would exceed either the daily or monthly cap is
refused and commits nothing (never a silent overspend); exactly-100% is admitted as WARN, over-100% blocks.
`toMetricPoints()` + `budgetAlert()` bridge to observability (WARN→`high_ai_cost`, BLOCKED→
`quota_exhausted`). Pure over an injected clock + accumulator; Postgres accumulator is a BLOCKED_EXTERNAL
stub.
