# 04 — Social-native dimensions (honest scope)

## What the normalized path carries
The report path fills the 10 canonical metrics: spend, impressions, clicks, conversions,
conversion_value, ctr, cpc, cpm, cpa, roas. These flow at every hierarchy level, so the following
media-buyer signals are **real at campaign / ad_group / ad level** (computed by the deterministic
engine, no fabrication):
- spend, impressions, clicks, CTR, CPC, CPM, conversions, CPA, conversions value, ROAS
- falling CTR, rising CPM, spend acceleration, conversion-rate deterioration, CPA/ROAS deterioration
  (these are exactly the diagnoses `diagnoseEntity` emits — now available at group/ad level too).

## What is NOT available (and is not faked)
- **frequency / reach / video views / hook-hold / 3s-views**: NOT in the normalized report path (not
  among the 10 metrics). The intelligence `CANONICAL_METRICS` vocabulary lists them for future use, but
  no adapter fills them in the report path today. We therefore do **not** compute frequency-based
  "fatigue" from the normalized path, and the UI shows NOT_AVAILABLE for these fields. (A creative
  fatigue *signal* exists separately and is only asserted when its evidence threshold is met — never
  auto-labelled "fatigue".)
- **placement / device / age / gender / geography breakdowns**: NOT in the normalized ReportRow for any
  provider. Reachable only via raw passthrough tools for meta / tiktok / reddit (RAW_ONLY — raw JSON,
  not canonical rows). See `09-breakdown-explorer.md`.
- **delivery / learning status**: not exposed in the report path; `entity.status` (ENABLED/PAUSED) is
  the only delivery signal carried.

## Capability gating
The connection registry's `reporting.dimensions` encodes per-provider dimension support
(RAW_ONLY / NOT_SUPPORTED). The UI never offers a dimension a provider cannot produce. Nothing here is
generalized across providers — the matrix is per the adapter audit in `01`.
