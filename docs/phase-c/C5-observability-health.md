# C.5 (6,7) — Observability export seam + health endpoints

## Export seam (C.5-6)

`lib/markting/ops/exporter.ts` adds the clean exporter interface the in-process observability model
lacked, without requiring any external backend:

- **`MetricExporter` / `TraceExporter`** interfaces + a `setMetricExporter()` / `recordMetric()` buffer
  (mirrors the `intel-telemetry.ts` pluggable-sink style).
- Adapters, all I/O-free by default:
  - **`NoopExporter`** — the default, used in CI/tests (no external dependency).
  - **`ConsoleLogExporter`** — structured-log backend; every payload routed through `redactLog` first.
  - **`PrometheusTextExporter`** — buffers points and `render()`s the Prometheus text exposition format
    (TYPE lines, sorted names, `organization_id` label, escaped values); a pure string, no server.
  - **`OpenTelemetryExporter`** — a **BLOCKED_EXTERNAL** adapter stub: implements the interface and
    buffers, but ships no OTLP network client (carries `blockedExternal: 'OTLP_COLLECTOR_ENDPOINT'`).
    Wiring a real OTLP collector is the deployment step, not code solvable here.

Exportable metrics cover the mission list: provider request latency, provider failures, rate limits,
sync queue depth, sync duration, webhook failures, freshness lag, token refresh failures, AI requests,
AI latency, AI estimated cost, DB errors, worker health — all already modeled as `MetricName`s in
`observability.ts` and now emittable through the seam.

## Health endpoints (C.5-7)

`lib/markting/ops/health.ts` — a pure `computeHealth(signals)` over 7 components: **APPLICATION,
DATABASE, QUEUE, WORKER, PROVIDER_AGGREGATE, WEBHOOK, AI_GATEWAY**, each resolving to **HEALTHY /
DEGRADED / UNAVAILABLE / UNKNOWN** with a terse, infra-free reason code. An absent probe signal yields
**UNKNOWN** (fail honest — never a fabricated HEALTHY). A worst-severity rollup + `healthHttpStatus()`
(UNAVAILABLE → 503, else 200) are provided.

`app/api/health/route.ts` — GET for an internal/operator caller. It runs a lightweight `select 1` DB
probe wrapped so any failure → `DATABASE: UNAVAILABLE` (never a stack trace), passes other probes as
absent → UNKNOWN rather than fabricating, and returns only `{state, reason}` per component + the rollup.
**No secrets, hostnames, versions, or connection strings are ever emitted** (operator-safe).

Tests: `test/exporter.test.ts` (9) + `test/health.test.ts` (12) — Prometheus rendering, redaction,
OTel-blocked buffering, every health state, fail-honest UNKNOWN, operator-safe serialization.

**Status:** seam + adapters + health states implemented + tested; a live OTLP/metrics backend export is
BLOCKED_EXTERNAL (deployment wiring).
