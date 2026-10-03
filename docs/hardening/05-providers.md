# 05 — Provider contract depth, replay & schema-drift safety (Programs 14–16)

## Meta contract depth (Program 14)
`packages/meta/test/meta-contract.test.ts` pins the replay edges a live Meta integration hits, on top
of the happy-path shapes in `meta.test.ts`: multi-page pagination (`paging.next`), missing/null optional
fields (no NaN), schema drift (unknown v26 fields ignored), and a 500 provider-error envelope mapped
through `formatMetaError` → `PROVIDER_ERROR`.

## Google replay suite (Program 15 — P0) — `807fb3f`
`packages/google/test/google-contract.test.ts` — the credential-less counterpart for Google Ads,
pinning the GAQL report-parsing contract: multi-page search via `nextPageToken`, missing metric fields
(`costMicros` absent → spend 0, guarded ratios, no NaN/Infinity), schema drift (unknown v26 fields and
unselected resources ignored), and the error envelope (`formatGoogleAdsError` → `PROVIDER_ERROR` with
field paths + request id). Fixtures are SYNTHETIC but shaped to the documented v25 `googleAds:search`
response (camelCase JSON, `costMicros` micros, `nextPageToken`). All Google package tests pass (29).

**Honest P0 remainder:** a **live-captured cassette** suite for both providers still needs real
credentials. This replay suite is the credential-less substitute, so Gate J (provider replay) is
**PARTIAL** — contract/replay edges are covered deterministically; live cassettes are the outstanding
go-live task.

## Provider schema-drift safety states (Program 16) — `807fb3f`
The data-quality shape (`lib/markting/orchestrator/seed.ts`) and `buildDataQuality`
(`orchestrator/sections.ts`) now model and surface the provider schema-drift states a live report would
attach to its metadata:
- `UNSUPPORTED_FIELD` — a requested field the provider does not support (omitted, **not** zero-filled);
- `MISSING_REQUIRED_DATA` — required data absent → dependent metrics UNKNOWN, never inferred (CRITICAL);
- `PROVIDER_SCHEMA_CHANGED` — the response shape no longer matches the pinned contract (CRITICAL);
- `MIXED_CURRENCY` — rows span currencies → totals/ratios withheld until normalized.

These render in the **Data Quality Center** with severity + code as a text label (status by label, not
color-alone). A schema change is therefore never silently mistaken for a performance change. In live
mode these come from the provider report's metadata; the seed exercises them end-to-end so the UI is
real and reachable today.
