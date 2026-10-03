# 09 — Provider Read-Capability Matrix (2Z)

Audited from `platform/packages/<provider>/src/{provider,client,tools}.ts`. Honest about what is a
first-class typed/normalized read vs. what is only reachable through a provider's generic
API-passthrough read tool. Nothing is labelled implemented that is not.

Legend: **✓** real dedicated/typed method or normalized `report()` path · **✓ᵍ** reachable ONLY via
the generic API-passthrough read tool (`*_api_read` / `google_gaql`), not a typed method ·
**✗** not implemented. "Breakdowns" = true dimension breakdowns (placement/age/gender/geo/device/
segment), not entity-level stat splits.

| Provider | Accounts | Campaigns | AdGroups/Sets | Ads | Creatives | Metrics | Breakdowns | Conversions | Budgets | Statuses |
|---|---|---|---|---|---|---|---|---|---|---|
| meta | ✓ | ✓ | ✓ | ✓ | ✓ᵍ | ✓ | ✓ | ✓ | ✓ᵍ | ✓ |
| google | ✓ | ✓ | ✓ | ✓ | ✓ᵍ | ✓ | ✓ | ✓ | ✓ᵍ | ✓ |
| tiktok | ✓ | ✓ | ✓/✓ᵍ | ✓/✓ᵍ | ✓ᵍ | ✓ | ✓ | ✓ | ✓ | ✓ |
| snapchat | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| apple | ✓ | ✓ | ✓ᵍ | ✓ᵍ | ✓ᵍ | ✓ | ✗ | ✓ (installs only) | ✓ | ✓ |
| microsoft | ✓ | ✓ | ✓ᵍ | ✓ᵍ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| reddit | ✓ | ✓ | ✓ᵍ | ✓ᵍ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| pinterest | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| linkedin | ✓ | ✓ | ✗ (no such level) | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |
| x | ✓ | ✓ | ✓ | ✓ | ✓ (internal) | ✓ (spend/impr/clicks) | ✗ | ✗ (unsupported) | ✓ | ✓ |
| spotify | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✓ |

## Priority providers (depth)

- **meta — DEEP.** Normalized `report()` + raw `meta_insights` (the only provider with true
  demographic/placement breakdowns) + generic `meta_api_read`. Gaps: creatives/budgets/status only via
  generic field selection; normalized rows omit entity status.
- **google — DEEP.** Normalized `report()` (account→ad) + fully generic `google_gaql` reaching
  breakdowns (`segments.*`), budgets, creatives, statuses. Most complete alongside meta.
- **tiktok — DEEP.** Typed `tiktok_campaigns` (budget+status), normalized `report()`, raw `tiktok_report`
  (dimension breakdowns), generic `tiktok_api_read`. Gap: ad groups/ads/creatives have no typed read.
- **snapchat — SHALLOW–MODERATE.** Only campaigns are read as entities (with budget+status). Ad squads
  and ads appear only as stat-breakdown ids inside `report()`, never as entities; no demographic
  breakdowns, no creatives, no generic passthrough.

## Secondary providers (summary)

apple (MODERATE–DEEP, broad allow-listed generic read; conversions = installs only, no revenue/ROAS);
microsoft (MODERATE, campaign-only normalized report; ad groups/ads via generic); reddit (MODERATE–DEEP,
flexible `reddit_report` with up to 4 breakdowns); pinterest (MODERATE, strong scoping, no demographic
breakdowns/creatives); linkedin (MODERATE, group>campaign>creative hierarchy — no ad-group level;
creative-id metric rows only, no metadata; no demographic pivots); x (MODERATE, full entity ladder but
metrics limited to spend/impressions/clicks — **conversions unsupported**); spotify (MODERATE,
account→ad_set→ad with conversions incl. revenue; no creatives/breakdowns).

## Cross-cutting honesty flags (consumed by the intelligence layer)

- **True demographic/placement/geo breakdowns** exist only for **meta, google, tiktok, reddit**. Every
  other provider is ✗ — `audience.ts` already encodes the meta/google/tiktok/snapchat support map and
  marks unsupported dimensions rather than fabricating them.
- **x has no working conversion metrics; apple conversions are installs only** (ROAS is 0/again
  unavailable) — the diagnostic engine's evidence gate correctly yields INSUFFICIENT_EVIDENCE for
  ROAS/CPA reads on those providers.
- **snapchat and linkedin genuinely lack an ad-set/ad-group entity read** — cross-campaign / per-adset
  analysis is not available there and must not be claimed.
- `✓ᵍ` capabilities are generic-passthrough reachable only; they are NOT documented as first-class.

## Staged improvements (not implemented this phase)

Typed creative reads (meta/tiktok), typed budget/status normalization into `report()` rows (meta),
and ad-set entity reads (tiktok) are the highest-value small additions; deferred so Phase 2 keeps the
engine + safety surface as the focus. None are claimed as present above.
