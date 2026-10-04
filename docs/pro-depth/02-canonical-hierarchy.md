# 02 — Canonical entity hierarchy

The canonical model already represented the four levels (`EntityLevel = account | campaign |
ad_group | ad`); Phase B added the missing **parent linkage** and **provider-native type**, without
flattening provider differences.

## What changed (additive only)
- `ReportRow.entity` (packages/core): optional `parentId` (provider-native id of the immediate parent)
  and `entityType` (verbatim provider label — "adset", "ad_group", "line_item"). Absent when the
  provider does not expose it.
- `CanonicalEntityRef` (intelligence/model): optional `parentRawId` + `entityType`.
  `normalizeReportRows` copies both through. `canonicalId = provider:account:rawId` is unchanged.
- `CampaignIntelligence` (analyze): optional `level`, `entityType`, `children`, `childContribution`.

## Provider-native semantics are preserved, not forced
The canonical `level` normalizes the tree, but `entityType` keeps the real label and the UI renders it
via `adGroupTerm(providerId)`:

| Provider | level ad_group shown as |
|---|---|
| Meta | Ad set |
| Google / TikTok / Pinterest / Reddit | Ad group |
| Spotify | Ad set |
| X | Line item |
| Snapchat | Ad squad |

LinkedIn has no ad_group level at all (provider limitation) — the registry marks it NOT_SUPPORTED and
the UI shows an explicit unsupported state rather than an empty table.

## No second hierarchy
There is exactly one entity model. The depth feature feeds more levels into the SAME
`normalizeReportRows` → `analyzeAccount` → orchestrator path; it does not add a parallel structure.
