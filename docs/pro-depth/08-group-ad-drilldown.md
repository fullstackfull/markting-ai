# 08 — Ad set/group → Ad drill-down (B8/B9)

The deepest two levels of the drill path. Both are built by the same level-generic, deterministic
section logic the campaign level uses — no level re-implements KPIs, comparison, trend or diagnosis.

## Routes

- `app/dashboard/accounts/[accountId]/campaigns/[campaignId]/groups/[groupId]/page.tsx` — ad set / ad
  group detail: parent breadcrumb (Account ▸ Campaign ▸ group), the provider-native type label via
  `adGroupTerm`, KPI cards (spend / conversions / CPA / ROAS / CTR / CPM / CPC), current-vs-previous
  comparison, CPA trend, an `AnalyticsTable` of its ads (`prefix='ad'`, sortable by spend / CPA / ROAS
  and more), an evidence-backed deterministic diagnosis + `EvidenceCard`, and a data-quality note
  (the account's `DATA_QUALITY` section).
- `app/dashboard/accounts/[accountId]/campaigns/[campaignId]/groups/[groupId]/ads/[adId]/page.tsx` — ad
  detail: full parent-hierarchy breadcrumb, status, the full KPI set (spend / impressions / clicks / CTR
  / CPC / conversions / CPA / ROAS), CPA trend, diagnosis and raw evidence. No multimodal / creative-
  media analysis (out of scope).

Both await the Promise `params` / `searchParams`, wire `RangeControl` + `FreshnessBar` + `parseRangeParam`
like the account page, and preserve `range` across every breadcrumb/row link.

## Data source

- **DEMO runtime**: `buildAdGroup(acc, campaignId, adGroupId)` and `buildAd(acc, campaignId, adGroupId,
  adId)` read the seed hierarchy (`SeedAdGroup` / `SeedAd` on each `SeedCampaign`) and run the shared
  helpers: `kpisFrom` (KPIs), `comparisonFrom` (current-vs-previous half), `classifyTrend` (CPA trend),
  and `diagnoseSeries`. The diagnosis describes ONLY what the engines computed — a rising/improving CPA
  trend and a CTR-falling-while-CPM-rises creative-fatigue signal — and lists the raw before/after
  numbers as evidence. There is NO hard-coded recommendation text; the finding is the computation.
- **Live runtime** (no provider wired): `loadAdGroup` / `loadAd` return `{ found: false }` with the
  honest "connect a provider" summary (the same posture `loadCampaign` takes), and the page renders a
  not-connected block instead of fabricated detail. `loadAdList` returns
  `{ state: 'NOT_CONNECTED', rows: [] }`.

Loaders (`lib/cloud/intelligence.ts`): `loadAdGroup`, `loadAdList`, `loadAd` (new), each branching on
`isDemoMode()`.

## Seed hierarchy (DEMO)

The primary demo account `sandbox:acc:ramadan` (meta vocabulary → "Ad set") carries a real hierarchy
with a believable performance story:

- **Awareness** campaign: `Lanterns – Broad reach` (dragging CPA — spend up, conversions down; contains
  the fatiguing `Lantern Video A` ad: CTR falling as CPM rises), `Gift Bundle – Lookalike 2%` (healthy),
  `Retarget – 30d` (small, efficient; `Retarget Static` is paused).
- **Brand Search** and **Prospecting** campaigns each carry 1–2 ad sets with 1–2 ads.

`sandbox:acc:electronics` (google vocabulary → "Ad group") carries a lighter hierarchy; `sandbox:acc:
fashion` carries none, which exercises the `NO_DATA` state in DEMO.

## Money / range (B15/B16)

Every amount renders via `formatMoneyMinor(minor, currency, locale)` (per-row currency, never raw minor
units). The single `range` param and the previous-window comparison from `resolveRange` apply at every
level.

## Capability gating (B22)

The ad-set level is gated on `reportingLevelSupport(providerId, 'ad_group')` and labelled with
`adGroupTerm(providerId)` from the registry. In DEMO the seed hierarchy is present, so the gating copy
is primarily for the live path — a connected provider whose adapter does not return a level shows an
explicit unavailable state (via `AnalyticsTable`'s `unavailable` prop) rather than an empty table.
