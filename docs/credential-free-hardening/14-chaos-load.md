# 14 — Disaster recovery + load/soak + chaos (items 39, 40, 41)

Files: `lib/markting/ops/disaster-recovery.ts`, `lib/markting/ops/chaos.ts` +
`test/disaster-recovery.test.ts`, `test/load-soak.test.ts`, `test/chaos.test.ts`.

## Disaster recovery (item 39)

A pure DR model. `RPO_TARGET_MS` (15m) / `RTO_TARGET_MS` (60m). `BACKUP_CONTRACT` enumerates the 7 artifacts
needed to recover; the 5 recovery-critical ones (schema migrations, encrypted secret **refs** — never
plaintext, connection state, in-flight sync cursors, idempotency keys) are marked critical.
`validateRestoreManifest()` **fails closed**: an empty manifest, any missing critical artifact, or any
critical artifact staler than RPO → `valid:false`. `planRecovery(crash)` reuses the connection-recovery
table + the executor's `resumeCursor` semantics: a provider-write crash with `doubleWriteRisk` yields
`RECONCILE_BEFORE_RETRY`, never a blind replay; every plan reports `dataLossRisk`/`doubleWriteRisk`.
`executeBackupSnapshot()`/`executeRestore()` are **BLOCKED_EXTERNAL** stubs (need infra) — no autonomous
action.

## Load / soak (item 40)

Deterministic simulations driving the **real** `paginate` + `runProviderRead` with fake transports at high
page/row counts: the `maxRows` cap stops exactly at the ceiling; `runProviderRead` → `PARTIAL_SUCCESS`
(resumable) when capped; loop protection fires on a non-advancing cursor; the `RateLimiter` throttles a
burst to exactly the binding ceiling with `retryAfterMs` and refills after an injected-clock advance; the
`CostBudgetEngine` hard-stops at the cap and never overspends; idempotency yields a single winner under a
claim race. A 10k-cycle soak (injected `FakeClock`) proves bounded memory — limiter state stays constant,
no unbounded growth.

## Chaos (item 41)

`chaos.ts` is a deterministic fault-injection harness (seeded `mulberry32` RNG + `ChaosClock` + a scripted
`FaultPlan`: inject AUTH/RATE_LIMIT/SCHEMA/TRANSIENT/PERMANENT signals, truncated pages, repeated cursors,
schema/reject rows, clock jumps, aborts) wrapping a `ProviderTransport` fed to the real `runProviderRead`.
The tests assert each fault **degrades safely**: the correct non-success status, recovery mapped via
`recommendRecovery`, loop detection → non-retryable PARTIAL_SUCCESS, abort → resumable UNKNOWN, clock-jump →
DEADLINE/TIMEOUT, kill-switch engaging after a PERMANENT fault, quarantine routing bad rows away — and a
final sweep asserting **no fault ever yields a false SUCCESS** (fails honest).
