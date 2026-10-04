# 01 — Provider hierarchy & dimension audit (B0)

Ground truth from reading every adapter in `platform/packages/<provider>/src/provider.ts`, the report
tool (`packages/core/src/tools/builtin.ts`), the normalized contract (`packages/core/src/model.ts`),
and the demo/synthetic providers. **Nothing here is generalized from one provider to another.**

## The hard ceiling (the normalized contract)
`ReportRow` = `{ provider, accountId, currency?, entity:{ level, id, name, status? }, metrics }`.
- `ENTITY_LEVELS = account | campaign | ad_group | ad` — only four levels exist.
- Base metrics in the report path = the 10 canonical (`spend, impressions, clicks, conversions,
  conversion_value, ctr, cpc, cpm, cpa, roas`). **No frequency/reach/video** in the report path.
- The entity is **flat**: no parent id, no provider-native type, no breakdown/segment/dimension field.
- `NormalizedQuery` has **no `breakdowns`/`segments`/`dimension` input** — so no breakdown can enter the
  normalized path for any provider, regardless of adapter capability.

Phase B adds optional `parentId` + `entityType` to `ReportRow.entity` (and `parentRawId`/`entityType`
to `CanonicalEntityRef`) — additive, no flattening. It does **not** add a breakdown field to the
normalized report path (that stays a Phase C candidate — see below).

## Level support per provider (does the adapter return rows at each level?)

| Provider | account | campaign | ad_set/ad_group | ad | Notes |
|---|---|---|---|---|---|
| meta | READY | READY | READY (ad set) | READY | requests campaign_id/adset_id but discarded them pre-B |
| google | READY | READY | READY (ad group) | READY | fetches parent name but discarded it pre-B |
| tiktok | READY | READY | READY (ad group) | READY | |
| pinterest | READY | READY | READY | READY | |
| spotify | READY | READY | READY (ad set) | READY | |
| x (twitter) | READY | READY | READY (line item) | READY | internal provider-native `type` dropped pre-B |
| reddit | READY | READY | PARTIAL | PARTIAL | group/ad rows use the id as the name (no name resolution) |
| snapchat | READY | READY | PARTIAL | PARTIAL | group/ad rows id-only name |
| linkedin | READY | READY | NOT_SUPPORTED_BY_PROVIDER | READY (creative) | no native ad-group level |
| microsoft | READY | READY | NOT_IMPLEMENTED (v0) | NOT_IMPLEMENTED | adapter caps at account+campaign |
| apple | READY | READY | NOT_IMPLEMENTED (v0) | NOT_IMPLEMENTED | adapter caps at account+campaign |

All 11 adapters have **real** authenticated HTTP transport, but all are **BLOCKED_EXTERNAL without
credentials** — none are present in this environment, so live depth is unverifiable here. The
**sandbox** (DEMO) and **synthetic** (tests/reviewers) providers returned **account+campaign only**
pre-B; Phase B extends both to emit group+ad rows (clearly SYNTHETIC) so the depth is demonstrable and
CI-testable end-to-end.

## Dimension / breakdown support (placement, device, age, gender, geo, network, keyword, search_term)
**NOT in the normalized report path for ANY provider.** Classification:
- Raw passthrough tools exist for **meta** (`meta_insights.breakdowns`), **tiktok**
  (`tiktok_report.dimensions`), **reddit** (`reddit_report.breakdowns`) — they return raw provider
  JSON, **not `ReportRow`** → **ADAPTER_ONLY**. No raw breakdown tool for the other 8.
- The product "breakdown" UI is **UI_ONLY over SYNTHETIC seed** (`sections.ts buildBreakdown` reads
  `acc.breakdowns`, hard-coded provider `meta`).
- keyword / search_term: **NOT_SUPPORTED** as report dimensions (google exposes them only as
  write/entity params) → no search-term reporting, so no live search-waste analysis (Phase C).
- objective / optimization_goal / bid_strategy / attribution_window / conversion_action / product-feed
  / catalog: **NOT_IMPLEMENTED** as report dimensions (write params or hard-coded single values only).
- frequency / reach / video / hook-hold: **not in the 10-metric report path** → social delivery
  signals are limited to what CTR/CPM/CVR/spend expose; frequency "fatigue" is **not fabricated**.

## Capability-aware consequence
Phase B extends `ProviderRegistryEntry` (in `lib/connections/registry.ts`) with a machine-readable
`reporting: { levels, dimensions }` sub-structure derived from this matrix, reused by both UI and
backend. The Breakdown Explorer and the drill-down surfaces are **gated** by it: a dimension/level the
registry marks unavailable is shown as an explicit unsupported state, never invented.
