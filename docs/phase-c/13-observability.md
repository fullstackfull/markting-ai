# C18 / C19 / C20 — Observability, alerting, incident workflow

## C18 — Observability (built; in-process model)

`lib/markting/ops/observability.ts`:

- `MetricName` union — request/provider/AI latency, `ai_cost_micros`, `sync_delay_ms`, `queue_depth`,
  `approval_aging_ms`, `write_success` / `write_failure`, `unknown_result_count`, `tenant_usage`.
- `redactLog` — secret redaction before any log leaves the process.
- `TraceSpan` + `TRACE_STAGES` — a 7-stage write trace (recommendation → … → audit).
- `SLO_TARGETS` — incl. `read_sync_freshness_minutes: 30` (couples to C9 freshness).

`lib/markting/ops/intel-telemetry.ts`: a typed `IntelEvent` union (`orchestrator_answer`,
`gather_duration`, `section_failure`, `context_truncated`, `provider_normalization_failure`), a
pluggable sink (default no-op), `emitIntelEvent` that never throws, and a `timed()` helper. The new
`PROVIDER_SCHEMA_CHANGED` signal (C11, `ops/schema-drift.ts`) and the sync-runner skip ledger (C8) feed
naturally into this event model.

Tests: `test/intel-telemetry.test.ts`.

## C19 — Alerting (rules + dedup)

`ALERT_RULES` (11 rules, incl. `kill_switch_triggered`, `webhook_verification_failure`, `sync_stuck`,
`high_ai_cost`) with `dedupeAlerts` windowed deduplication.

## C20 — Incident workflow (honest gap)

The alert **rules + dedup** are modeled, but **delivery** (a sink to a pager/Slack/email) and an
**incident/escalation/on-call state machine** are not built. This is an honest gap: the detection side
is in place; the delivery/escalation side is outstanding. It is partly environmental (no alerting
destination configured) and partly greenfield workflow code — recorded here rather than faked.

## Backend wiring

The observability model is in-process ("wired at edge in production" per the module comment); shipping
metrics/traces to a real backend (OTLP collector, metrics store) is a deployment-time step and is
BLOCKED_EXTERNAL in this environment.

**Status:** metrics/trace/telemetry model + alert rules/dedup implemented + tested; alert delivery,
incident/escalation workflow, and backend export outstanding / BLOCKED_EXTERNAL.
