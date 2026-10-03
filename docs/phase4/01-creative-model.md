# 01 — Canonical Creative Model (4A)

`creative/model.ts`.

Entities: `Creative`, `CreativeAsset`, `CreativeText`, `CreativePerformance`, `CreativePlacement`,
`CreativeVariant`, `CreativeClusterRef`, `CreativeSignal`. A `Creative` carries provider / org / account
/ campaign / ad-group / ad ids, media type, status, first/last seen, active flag, text, assets,
placements, performance, and trust metadata.

Principles:
- **Original identifiers preserved.** Every entity keeps its untouched provider `rawId`/`rawAssetId`
  plus a namespaced canonical id (`creativeId(provider, account, rawId) = provider:account:rawId`), and
  a `raw` bag for provider-specific fields. Nothing is destroyed on normalization.
- **Trust travels with the numbers.** `Creative.trust` is a `DataTrust` (tier, complete, currency,
  sampleSize, …) so every creative metric can be evidence-gated.
- **Currency explicit.** Monetary performance is in the reporting currency; it is never blended across
  currencies (the aggregate/cluster layer leaves money ratios undefined on mixed currency).
- **Media type explicit** (image/video/carousel/text/other), with per-asset dimensions/duration/format
  and a `contentHash` slot for dedup.

Supported creative metrics (`CREATIVE_METRICS`): spend, impressions, clicks, ctr, cpc, cpm,
conversions, cpa, conversionValue, roas, frequency.
