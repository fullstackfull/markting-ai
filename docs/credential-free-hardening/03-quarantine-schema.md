# 03 — Data quarantine + schema versioning (items 5, 6)

`lib/markting/ops/quarantine.ts`, `lib/markting/ops/schema-version.ts`,
`platform/supabase/migrations/20261020000000_quarantine.sql`,
admin section in `app/(admin)/admin/data-quality/page.tsx`,
`test/quarantine.test.ts` + `test/schema-version.test.ts`.

## Quarantine (item 5)

Bad provider rows are never silently dropped and never ingested. `classifyForQuarantine(row, ctx)` is a
pure classifier returning a reason or `null` (clean):

- `MALFORMED_ROW` — structurally invalid / missing required fields
- `SCHEMA_DRIFT` — fields present that the expected contract does not know
- `OWNERSHIP_MISMATCH` — row's account not owned by the tenant (defense in depth over RLS)
- `IMPOSSIBLE_VALUE` — negatives/NaN where impossible
- `UNSUPPORTED_CURRENCY` — a currency the pipeline cannot canonicalize (never FX-inferred)
- `INVALID_TIMESTAMP` — unparseable/out-of-range dates

`partitionForQuarantine` / `ingestWithQuarantine` split a batch into accepted + quarantined. A
`QuarantineStore` port has an `InMemory` fake and a `PostgresQuarantineStore` (durable aggregate: bumps a
count + last-seen, keeps first-seen, and stores only a **redacted sample** — never the raw payload).
`quarantineOverview()` feeds the admin Data Quality surface.

### DB gotcha captured

The store's `redactedSample` jsonb column round-trips as a **string** in this postgres config, so
`rowToRecord()` parses it defensively (`JSON.parse` guarded by try/catch). Reads also rely on camelCased
column names (`db()` transform). Both are the recurring platform gotchas, handled.

Migration `markting_quarantine`: RLS enabled, `adport_backend` RW + `adport_platform_admin` SELECT, **no**
tenant/member policy (operational table, default-deny for tenants).

## Schema versioning (item 6)

`schema-version.ts` keeps a `ProviderSchemaMetadata` registry (provider → version + known field set) and
`checkCompatibility(expected, seen)` → `COMPATIBLE | MINOR_DRIFT | BREAKING`. Added fields are MINOR_DRIFT
(forward-compatible); removed/retyped required fields are BREAKING and feed the executor's
`SCHEMA_CHANGED` path + the quarantine `SCHEMA_DRIFT` reason. Pure; no I/O.
