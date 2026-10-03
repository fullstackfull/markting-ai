# 06 — SRE / Observability (7N/7O/7P/7Q/7R)

`ops/observability.ts`.

## Metrics / logs / traces

Metrics: request/provider/AI latency, error rates, AI cost, sync delay, queue depth, operation states,
approval aging, write success/failure, UNKNOWN_RESULT count, tenant usage. Logs are structured,
correlated, tenant-aware, and SECRET-REDACTED (`redactLog` strips token/secret/password/authorization/
access_token/refresh_token/api_key/key recursively). Traces follow the canonical governed-write stages:
user_request → analysis → recommendation → preview → approval → provider_write → outcome.

## SLOs (internal targets, not customer SLA)

API availability 99.5%, read sync freshness 30m, recommendation availability 99.0%, approval-service
p95 1s, write-processing p95 5s. We do NOT invent customer SLA commitments.

## Alerting (7O)

Rules: failed provider write, UNKNOWN_RESULT, repeated OAuth failure, sync stuck, DB error, kill switch
triggered, quota exhausted, high AI cost, webhook verification failure, backup failure, migration
failure. `dedupeAlerts` collapses repeated rule+key within a window to avoid alert storms.

## Queues / workers (7P) — design

Production-critical background work (sync, AI jobs, reports, observation jobs, operation
reconciliation, notifications) uses durable, cluster-safe queues with lease semantics — no process-local
queue. Graceful shutdown: stop claiming, finish or safely release leased work, drop nothing. (The
atomic-claim model in `ops/store.ts` provides the single-winner lease for operations.)

## Rate limits (7R) — design + existing

User / org / API-key / AI-usage / provider-call limits protect the AI gateway, reports, exports,
webhooks, and the provider-write endpoints (building on the existing `private.rate_limit_buckets`).
Limits never break legitimate idempotent retries (the operation digest + atomic claim are the
idempotency anchor).
