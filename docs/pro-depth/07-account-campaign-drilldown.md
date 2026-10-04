# 07 — Account → Campaign drill-down (B7)

The first two levels of the professional drill path, each driven by the reused Phase-B analytics table.

## Drill path

```
Workspace → Account → Campaign → Ad set/group → Ad
                 │          │
                 │          └── AnalyticsTable of ad sets / ad groups (prefix 'g')  → see 08
                 └── AnalyticsTable of campaigns (prefix 'c')
```

- `app/dashboard/accounts/[accountId]/page.tsx` — the campaign list is now an `AnalyticsTable`
  (`prefix='c'`), sortable by name / spend / conversions / CTR / CPA / ROAS / CPA-trend, each row an
  `EntityLink` to the campaign route (with the active `range` preserved). The existing diagnosis /
  pacing / anomaly / forecast / creative / commerce / breakdown / cross-channel / memory / outcomes
  sections are unchanged.
- `app/dashboard/accounts/[accountId]/campaigns/[campaignId]/page.tsx` — now wires `RangeControl` +
  `FreshnessBar` + `parseRangeParam` exactly like the account page, adds a parent breadcrumb
  (Account ▸ Campaign), and renders an `AnalyticsTable` of the campaign's ad sets / ad groups
  (`prefix='g'`, columns: native-type · status · spend · impressions · clicks · CTR · CPA · conversions ·
  ROAS · spend-share; presets Performance / Efficiency / Delivery). The creative-health, outcomes and
  experiment-entry sections are kept.

`params` and `searchParams` are Promises (this Next.js); both pages await them. Each table's state lives
in prefixed URL params (`c_sort`, `c_dir`, …; `g_sort`, …) so the two tables plus the Phase-A `range`
never collide and every view is refreshable/shareable.

## Data source

- **DEMO runtime** (the dashboard reads the orchestrator SEED, not a live provider): the campaign rows
  come from `buildCampaignRows(acc)` and the ad-group rows from `buildCampaign(acc, campaignId).adGroups`
  in `lib/markting/orchestrator/sections.ts`, computed by the same deterministic helpers the campaign
  KPIs use (`kpisFrom` / `comparisonFrom` / `classifyTrend`). The seed is CLEARLY SYNTHETIC and
  deterministic; trust tier is `SYNTHETIC` throughout.
- **Live runtime** (no provider wired): `loadCampaignList` returns `[]` and `loadAdGroupList` returns
  `{ state: 'NOT_CONNECTED', rows: [] }`, so the campaign surface renders the honest not-connected state
  rather than demo content — exactly the posture `loadCampaign` already takes.

Loaders (`lib/cloud/intelligence.ts`): `loadCampaignList`, `loadAdGroupList` (new). Both branch on
`isDemoMode()`: seed in DEMO, honest empty/not-connected otherwise.

## Money / attribution / range (B15/B16)

Amounts render through the Phase-A `formatMoneyMinor(minor, row.currency, locale)` — never raw minor
units, currency per row, `MIXED_CURRENCY` where a table would span currencies (seed accounts are
single-currency, so no blending occurs). The single `range` param flows end-to-end; the comparison
period is the previous equal-length window from `resolveRange`.

## Capability gating (B22)

The campaign surface distinguishes three states on the ad-group table:

- `NO_DATA` — the (seed) source has no ad groups for this campaign → the table's normal empty state.
- `NOT_CONNECTED` — live, no provider wired → `AnalyticsTable`'s `unavailable` block (title + reason).
- `NOT_SUPPORTED_BY_PROVIDER` — a connected provider whose adapter does not return the `ad_group` level
  (`reportingLevelSupport` is `NOT_SUPPORTED` / `NOT_IMPLEMENTED`) → also an `unavailable` block.

In DEMO the seed provider's hierarchy IS present, so the unsupported copy matters chiefly for the live
path (see `lib/connections/registry.ts` `reportingLevelSupport` / `adGroupTerm`).

## Provider-native naming

The ad-group level is labelled with the real provider vocabulary via `adGroupTerm(providerId)` — "Ad
set" (meta), "Ad group" (google), "Line item" (x), "Ad squad" (snapchat). The demo `provider` is the
synthetic `sandbox`, so each seed account names a representative `nativeAdProvider` (ramadan → meta,
electronics → google) used ONLY for this vocabulary; it never changes the trust posture.
