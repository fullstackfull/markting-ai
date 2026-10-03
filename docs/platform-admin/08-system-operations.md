# 08 — System Operations: Jobs, Queues, Cron, Observability (Discovery)

## Scheduled work (pg_cron) — only two live jobs
- `adport-data-retention` daily 03:17 → `private.apply_data_retention()` (`20260817171039_cloud_initial_schema.sql:408`;
  extension created `:373`).
- `adport-account-selection-expiry` every 10 min (`20260831152537_provider_account_selection.sql:22`).
- **`private.purge_expired_mcp_oauth_records()` is defined but NEVER scheduled** (`20260825120000_mcp_oauth.sql:71-94`;
  no `cron.schedule` for it) → expired/revoked MCP OAuth rows accumulate indefinitely. GAP-OPS-02.

## Queue tables that exist but have NO runner
- `markting_observation_jobs` (status scheduled/running/done/failed/cancelled, partial index)
  `20261006000000_phase3_memory_outcomes.sql:89-103`.
- `markting_reconciliation_jobs` (PENDING/RUNNING/…/GAVE_UP, attempts, next_attempt_at)
  `20261011000000_phase7_governance.sql:99-109`; upsert `store.ts:155-160`.
- **No background worker / scheduler process** drains these (no BullMQ/cron/setInterval consumer in app code). The
  upsert functions exist; nothing dequeues. GAP-OPS-01.

## Operator UI for jobs — MISSING entirely
No page or API route reads any job table. `queue_depth` is only a `MetricName` string
(`lib/markting/ops/observability.ts:9`). No retry/dead-letter operator concept (commerce has a per-org dead-letter log
`markting_commerce_events`, but no cross-tenant backlog view — see `06`).

## Observability
- `lib/markting/ops/observability.ts` is a **design-only in-process model**: MetricName union (`:6-9`), MetricPoint/
  TraceSpan types, `redactLog` secret redaction (`:13-27`), TRACE_STAGES (`:32`), SLO_TARGETS (`:35-41`), ALERT_RULES
  string list (`:44-49`), pure `dedupeAlerts` (`:54-64`). Header admits "a real metrics backend is wired at the edge in
  production" (`:4-5`). **No emitter, exporter, or sink in this repo.**
- **Logging:** ad-hoc `console.error(JSON.stringify({level,message,…}))` scattered (`app/api/support/route.ts:39`,
  `lib/http.ts`, `ai-gateway.ts`, `billing/webhook/route.ts`, `oauth/.../callback/route.ts`). No structured-logger
  abstraction; **no correlation/request-id propagation** (`traceId` exists only as a `markting_operations` column /
  span field, not wired through HTTP).
- **Health/metrics endpoints:** MISSING — no `/health`, `/healthz`, `/readyz`, `/metrics` route.
- Classification: logging = implemented-backend (primitive, not operator-reachable); observability model = design-only;
  tracing = design-only; health/metrics endpoints = missing; alert rules/SLOs = design-only constants with no evaluator.

## Implications
A System-Operations console (job/queue state, retries, dead-letter backlog, cron health, worker heartbeat; plus
health/metrics endpoints and correlation-id propagation for support/audit) is **greenfield**, and two hygiene fixes
are independent prerequisites: schedule `purge_expired_mcp_oauth_records` (GAP-OPS-02), and build an actual runner for
the reconciliation/observation queues before surfacing them (GAP-OPS-01). Note: much of production observability
likely lives at the edge/platform layer outside this repo — an operator dashboard should federate those, not
re-implement a metrics backend here. See `13`, `14`.
