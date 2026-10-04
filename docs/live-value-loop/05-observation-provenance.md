# 05 — Observation Provenance & Validation (A4)

**Provenance:** every observation keeps provenance on `trust` — `tier` (`PLATFORM_REPORTED` for a live read;
`SYNTHETIC` for demo/fixture), `source` (`<provider>-report` vs `sandbox-fixture`), `freshnessAt` (read
time), `currency`, `timezone`, `attributionBasis`, `dateRange`. The dataset label is `LIVE`. The live
gatherer returns an explicit `provenance: 'LIVE'`. Demo/fixture data can never appear in LIVE mode
(source-isolation guards fail closed).

**Validation (`validateReportRow`, no silent coercion):** rejects/classifies rows with a missing account or
entity identity, a non-finite metric (NaN/Infinity), an impossible negative metric, or an unsupported
currency (unknown decimal exponent). Rejected rows are collected with reasons (surfaced for telemetry),
valid rows are normalized. Tenant ownership is guaranteed by construction — rows come from the tenant's own
runtime (`createTenantRuntime(principal)`), never cross-tenant. Tests: `test/live-gatherer-validation.test.ts`.

**Idempotency / dedup:** observations use a deterministic canonical id (`provider:accountId:rawId`), so
re-collecting the same report yields identical ids and a replayed analysis is byte-stable (asserted in
`test/live-value-loop.test.ts`). As the loop computes in-memory per request (no observation store), repeated
collection cannot create duplicate rows.
