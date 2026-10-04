# C.5 (1,2) — Sync worker + scheduler (operations)

## Runtime

`lib/markting/ops/sync-worker.ts` drives the pure C8 dispatch core on an interval:

- **`SyncWorker`** — safe `start()` (idempotent) / `stop()` (graceful drain), single-flight ticks (never
  overlapping), so concurrency is governed only by the limits, never by tick overlap.
- **`runSyncTick`** — one cycle: `loadDispatchable` + `loadInflight` → `planDispatch` → atomic `claim`
  per job → `guardJob` → `executor.execute` → record `onSuccess` / `onFailure`. Emits
  `sync_queue_depth`, `sync_duration_ms`, `sync_success`/`sync_failure`/`sync_dead_letter` metrics and
  structured logs.
- **Executor seam** — `SyncExecutor.execute(job)` is the only live-I/O point and is **BLOCKED_EXTERNAL**
  (no credentials). Sync is **READ-ONLY** — the worker performs no provider write (Mode B HELD).

## Worker safety (enforced by `guardJob`, before every execution)

A job is **never** executed when any of these holds — it is returned to `QUEUED`, not failed:

- a kill scope is active (global/org/provider/type) — authoritative async re-check, not just the
  planner's best-effort predicate;
- the connection is disabled/revoked;
- the runtime source mode disallows live execution;
- the provider capability registry does not support the sync.

An `UNKNOWN` executor result is **never blind-retried as success** — it is parked (and, for writes, owned
by the `ops/idempotency.ts` reconciler). A job always carries the server-trusted org/provider from its
row, so it can never run under another tenant's context.

## Queue (one implementation)

`public.markting_sync_jobs` via `PostgresSyncQueue` (`sync-store.ts`): idempotent enqueue on
`(organization_id, provider, idempotency_key)`, a single-winner atomic `claim` (conditional `UPDATE …
RETURNING`), expired-lease reclaim for crash recovery, and retry/backoff/dead-letter state. There is no
second queue. Reads use `db()` which camelCases columns.

## Scheduler

`sync-scheduler.ts` — `decideSchedule(connection, now)` picks the next sync per provider cadence
(`PROVIDER_CADENCE`): ads hourly+ (`REAUTH_REQUIRED` > `MANUAL_RETRY` > `INITIAL` > `INCREMENTAL`),
commerce daily as a webhook backstop (not near-real-time). `WEBHOOK_TRIGGERED` jobs are enqueued by the
webhook ingress path, not the scheduler.

## Tests

`test/sync-worker.test.ts` (12 unit) + `test/sync-worker.database.test.ts` (4 real-Postgres:
idempotent enqueue, single-winner atomic claim, lease reclaim, dispatchable filtering).

**Status:** runtime + scheduler + durable queue implemented and tested; the live provider executor is
BLOCKED_EXTERNAL.
