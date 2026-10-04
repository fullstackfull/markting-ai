# C8 — Background sync worker

## Scheduling core (built, pure, tested)

`lib/markting/ops/sync-runner.ts` is the deterministic dispatch model — the hard part of a
multi-tenant sync worker, built as a pure function so fairness/rate-limits/retries/leases are fully
unit-tested without any provider I/O.

- **Sync-type taxonomy**: `INITIAL`, `INCREMENTAL`, `REAUTH_REQUIRED`, `MANUAL_RETRY`,
  `WEBHOOK_TRIGGERED` (`SYNC_TYPES`), each with a default priority (`SYNC_TYPE_PRIORITY` — reauth and
  webhook first, initial backfill last).
- **Bounded global concurrency** (`maxConcurrent`) and **per-tenant fairness** (`maxPerOrg`): one org
  cannot monopolize the pool; slots are shared across tenants under the cap.
- **Per-provider rate limiting**: a token-bucket snapshot per provider; a job costs one token; a
  provider at zero tokens is `RATE_LIMITED` and deferred (a provider absent from the map is unlimited).
- **Lease + crash recovery**: `leaseJob` stamps an expiry; `planDispatch` reclaims a `LEASED` job whose
  lease has expired (a crashed worker's job is picked up again), while a live lease counts against
  concurrency and is never double-dispatched.
- **Retry / backoff / dead-letter**: `onFailure` increments attempts and schedules a retry with
  exponential **full-jitter** backoff (`backoffMs`, capped), or moves the job to `DEAD_LETTER` at
  `maxAttempts`. `onSuccess` is terminal.
- **Kill-switch gating**: a `KillPredicate` (wired to `ops/kill-switch.ts`) short-circuits any job under
  an active global/org/provider/action kill scope — it is never dispatched.
- **Idempotency**: each job carries an `idempotencyKey`; the runner treats re-enqueue of the same key as
  the same unit of work, composing with the existing `ops/idempotency.ts` atomic-claim + unknown-result
  reconciliation so a retry never produces a second live effect.

`planDispatch(queue, ctx)` returns `{ dispatch, skipped }` — the jobs to lease now plus a reasoned skip
ledger (`MAX_CONCURRENT`, `ORG_FAIRNESS_CAP`, `RATE_LIMITED`, `BACKOFF_WAIT`, `DEAD_LETTER`,
`KILL_SWITCH`) for observability and tests. Ordering is `(priority asc, enqueuedAt asc, id)` — stable
and starvation-free.

Tests: `test/sync-runner.test.ts` (12) — concurrency, fairness, token bucket, backoff/jitter/cap,
dead-letter, lease reclaim, kill-switch, priority order.

## Reused primitives

- Commerce incremental sync state machine: `lib/markting/commerce/sync.ts` (cursor + high-water
  checkpoint, `MAX_PAGES_PER_RUN` bound, dead-letter, bounded backfill window).
- Execution state machine (`ops/state-machine.ts`), idempotency/reconcile (`ops/idempotency.ts`),
  kill-switch (`ops/kill-switch.ts`), provider health (`ops/provider-health.ts`).

## BLOCKED_EXTERNAL

The live execution loop that consumes a dispatch plan and performs real provider reads/writes requires
provider credentials, which do not exist in this environment. It is a thin I/O shell over the pure core
above and is **BLOCKED_EXTERNAL** — not implemented against live providers, never fabricated. A durable
queue table + worker process (and its cron/queue transport) are the remaining live-wiring step.

**Status:** scheduling core implemented + unit-tested; live execution loop BLOCKED_EXTERNAL.
