# 01 — Live sync executor shell + canonical result contract (items 1, 2, 4)

`lib/markting/ops/provider-executor.ts` + `test/provider-executor.test.ts` (16 tests).

## What it is

The provider-specific I/O shell the sync worker drives, built so the *hard logic* is testable now while
only a thin credentialed HTTP seam remains BLOCKED_EXTERNAL. The shell does **no real network I/O**: a
`ProviderTransport<Row>` port is injected — a fake/contract transport in tests; a real HTTP client only
when credentials exist (never in this phase).

## Canonical result contract (item 2)

`ExecutorResult` is the single envelope every provider read resolves to:

- `status`: `SUCCESS | PARTIAL_SUCCESS | REAUTH_REQUIRED | RATE_LIMITED | PROVIDER_ERROR | SCHEMA_CHANGED | UNKNOWN`
- `errorClass`: `NONE | AUTH | RATE_LIMIT | SCHEMA | TRANSIENT | PERMANENT | TIMEOUT | AMBIGUOUS`
- counts: `rowsRead / rowsAccepted / rowsRejected`
- `retryable` (never true for AUTH/SCHEMA/PERMANENT), `retryAfterMs` (rate limit), `resumeCursor`
  (partial), `paginationStop`, and a terse secret-free `evidence` string.

No raw tokens or payloads ever enter the envelope.

## Shell responsibilities (item 1)

`runProviderRead(job, transport, budget, guards, observer, opts)` owns everything *around* the provider
call: request budgeting (`DEFAULT_EXECUTOR_BUDGET` = 50 pages / 10k rows / 60s), bounded paginated
iteration (delegates to `paginate`, doc 02), cancellation/timeout via an injected clock + `isAborted`,
rate-limit propagation, retry classification, schema-drift hand-off (any row classified `SCHEMA` wins and
forces `SCHEMA_CHANGED`, never trusting the run), and two guards checked **before any read**:

- `sourceModeAllows` false → `PROVIDER_ERROR / PERMANENT` (source mode disallows a live read).
- `connectionActive` false → `REAUTH_REQUIRED / AUTH` (disabled/revoked connection), non-retryable.

## Partial failure handling (item 4)

Pagination stop reasons map to honest outcomes: `COMPLETE`→SUCCESS; `DEADLINE`→PARTIAL_SUCCESS (resumable);
`MAX_PAGES`/`MAX_ROWS`→PARTIAL_SUCCESS (resumable); `LOOP_DETECTED`→PARTIAL_SUCCESS but **non-retryable**
PERMANENT; `ABORTED`→UNKNOWN/AMBIGUOUS. A thrown `ProviderSignal` is classified by kind; any *unclassified*
throw is `UNKNOWN / AMBIGUOUS` — never blind-retried as success (the worker parks it).

`toExecOutcome()` bridges the canonical result to the existing worker `ExecOutcome` (OK/ERROR/UNKNOWN). A
small registry (`registerProviderTransport` / `resolveProviderTransport`) lets provider transports be wired
without the shell knowing any provider specifics.

## BLOCKED_EXTERNAL boundary

The real HTTP transport (the only thing that would touch a provider) is not implemented and not invoked.
Everything above it is pure over the injected transport + clock, and fully covered by the fake-transport
tests.
