# C — Live commerce transport (Shopify / WooCommerce / Salla / Zid)

**Honesty preamble.** The commerce domain model, incremental sync engine, and signed webhook verifier
are **built and unit-tested**, but there is **NO live HTTP transport wired and no mounted webhook
route**, and no merchant credentials exist in this environment. The registry records this honestly:
`liveTransportImplemented: false` for every commerce connector
(`lib/connections/registry.ts:154-185`). Every commerce contract fixture is `SYNTHETIC`
(`test/fixtures/connection-contract-provenance.ts:35-39`). Live commerce is **`BLOCKED_EXTERNAL`**.
Nothing below was observed from a real store.

## Commerce domain model (`lib/markting/commerce/model.ts`)

- **Minor-unit Money.** `CommerceMoney` is an integer `(minorUnits, currency)` pair — **never a float**
  (`model.ts:20-21`). Arithmetic fails closed on mixed currency (`addMoney`/`subMoney`/`sumMoney` throw
  or return `null`, never blend — `model.ts:249-272`).
- **Merchant vs platform truth.** The central rule: ad-platform-reported conversion value is **not**
  merchant business revenue; merchant truth (orders, refunds, COGS, margin) is kept entirely separate
  from platform attribution (`model.ts:1-15`). Analysis only — nothing writes to a store
  (`model.ts:13-14`).
- **UNKNOWN COGS, never zero.** COGS is **never inferred from selling price**; unknown cost stays
  `undefined`/`null`, never 0 (`profit.ts:5`, `model.ts:115-116`). A line with no trusted
  `CostObservation` contributes no COGS, and an order with any unknown line yields a `null` total — a
  partial COGS is not a trusted total (`profit.ts:35-41`). Margin returns a `notComputableReason`
  (`'COGS unknown — margin/profit cannot be computed (never inferred from price)'`) rather than a number
  (`profit.ts:85`).

## Incremental sync state machine (`lib/markting/commerce/sync.ts`)

Incremental, cursor-based, idempotent, tenant-scoped, retry-safe, bounded, observable (`sync.ts:1-9`):

- **Cursor + high-water checkpoint** persisted and resumed from; never a full-history re-fetch
  (`SyncCheckpoint`, `sync.ts:13-23,69-72`).
- **MAX_PAGES_PER_RUN = 50** bounds every run; if a cursor remains at the last page the result is
  `partial` and the next run resumes (`sync.ts:51,80-93`).
- **Dead-letter on failure** with the checkpoint preserved — no data loss on retry
  (`sync.ts:97-104`). Org is stamped server-side on every order, never taken from payload
  (`sync.ts:84-85`). Backfill is an explicit bounded window (`backfillWindow`, `sync.ts:109-114`).

## Signed webhook verifier (`lib/markting/commerce/webhooks.ts`)

- **HMAC-SHA256 + `timingSafeEqual`** over the exact raw body, with a length check before comparison
  (`verifySignature`, `webhooks.ts:37-44`).
- **5-minute replay window** — stale timestamps (`|now − ts| > maxSkewMs`, default `5 * 60_000`) are
  rejected `REPLAY` (`webhooks.ts:50-60`).
- **Dedup** by persisted `(connectionId, externalEventId)` → `DUPLICATE` (`webhooks.ts:62-64`).
- **Tenant derived from `connectionId`, never the payload.** The org + signing secret come from
  `resolveConnection(connectionId)`; the payload's own org/store id is never used to decide the tenant
  (`webhooks.ts:3-6,28-35,54-65`).
- Note: the verifier exists but **no HTTP route mounts it** (`registry.ts:181` — `webhook: true` with
  "no HTTP route mounted yet").

## Reconciliation states (`lib/markting/commerce/reconciliation.ts`)

Platform-vs-merchant variance is classified, never implied as fraud. States:
`ALIGNED` / `EXPECTED_VARIANCE` / `MATERIAL_VARIANCE` / `NOT_COMPARABLE` / `INSUFFICIENT_DATA`
(`reconciliation.ts:13,52-102`). Different currencies short-circuit to `NOT_COMPARABLE` (no governed FX),
and small samples (< 25 orders) are marked `LOW` sufficiency so a large % gap reads as weak evidence, not
an alarm (`reconciliation.ts:24,64-89`). Cross-currency sums require an explicit governed `FxRate` —
a model-supplied rate is never accepted (`reconciliation.ts:128-142`).

## Posture

Adapters + sync + webhook-verifier are built against an **injectable transport seam** with no live HTTP
client and no credentials, so the registry marks `connect:false`, `testConnection:false`, read-only
(`writeControls:false`), `liveTransportImplemented:false` (`registry.ts:166-185`). No COGS is inferred;
unknown stays unknown.

**Status:** commerce model + incremental sync + HMAC webhook verifier + reconciliation are built and
unit-tested, but **no live HTTP transport is wired and no webhook route is mounted** →
`liveTransportImplemented = false` → **`BLOCKED_EXTERNAL`** (no credentials); no inferred COGS.
