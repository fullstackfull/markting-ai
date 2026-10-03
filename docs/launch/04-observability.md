# 04 — Observability (Stage 7)

## Implemented (model) — `lib/markting/ops/observability.ts`
Metric names (request/provider/AI latency, error rates, AI cost, sync delay, queue depth, operation
states, approval aging, write success/failure, UNKNOWN_RESULT count, tenant usage); structured,
tenant-aware, SECRET-REDACTED logs (`redactLog` strips token/secret/password/authorization/*_token/
api_key/key, recursively — tested); trace stages user_request→analysis→recommendation→preview→approval→
provider_write→outcome; SLO targets; alert rules + dedup (`dedupeAlerts`, tested).

## Dashboards (to wire at the edge)
Application Health, Database Health, Queue Health, Provider Health, AI Gateway, Commerce Sync, Approval
Queue, Execution Operations, UNKNOWN_RESULT, AI Usage/Cost. The data each needs is produced by the
engine (`ops/surfaces.ts` + `markting_operations`/`markting_provider_health`/`markting_reconciliation_jobs`);
a metrics/log/trace BACKEND is BLOCKED_EXTERNAL and wired at deploy.
