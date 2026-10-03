# 09 — Media-Buyer Capability Matrix

> Author: A16 (Head of Paid Media). Source of truth: repository code at HEAD. Cells are derived from the
> specialist reports A1–A15 (`docs/audit/agents/A*.md`) and spot-checked by re-opening the cited code
> (see `docs/audit/agents/A16.md` for the spot-check log). Where a specialist's exact line number did not
> match the current tree, the substance was re-verified and the corrected citation is used in the footnotes.

## Legend

| Value | Meaning |
|---|---|
| **FULL** | Can read the entity/metric *and* act on or analyze it as a senior buyer would. |
| **READ_ONLY** | Can retrieve/compute it with reasonable completeness; no corresponding action, or action lives elsewhere. |
| **PARTIAL** | Exists but materially limited (missing fields/levels, raw-passthrough only, untested, or generic-not-platform-aware). |
| **WRITE_ONLY** | Can mutate but there is little or no structured read-back of what was changed. |
| **MOCK** | Only present in fixtures / demo data; no live path. |
| **MISSING** | Not implemented anywhere. |
| **UNKNOWN** | Could not be verified from code in this audit. |

Headline: **no cell in this matrix is FULL.** The strongest channels reach READ_ONLY (reporting) plus a
narrow, policy-gated WRITE surface (budget/status) that is *not* a matrix row. Everything a senior buyer
calls "analysis" (breakdowns, audience, placement, fatigue, pacing-to-action, forecasting, allocation) and
everything that makes a *business* buyer (store revenue, profit, MER, CAC, LTV) is PARTIAL or MISSING across
all eleven channels.

## Matrix

Columns: Meta · Google · TikTok · Snap · MS (Microsoft) · LI (LinkedIn) · Pin (Pinterest) · Rdt (Reddit) · X · Spt (Spotify) · Apl (Apple).

| Capability | Meta | Google | TikTok | Snap | MS | LI | Pin | Rdt | X | Spt | Apl |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Account discovery | PARTIAL¹ | READ_ONLY¹ | PARTIAL¹ | READ_ONLY¹ | PARTIAL¹ | READ_ONLY¹ | PARTIAL¹ | PARTIAL¹ | PARTIAL¹ | PARTIAL¹ | PARTIAL¹ |
| Campaign discovery | PARTIAL² | PARTIAL² | PARTIAL² | PARTIAL² | PARTIAL² | READ_ONLY² | PARTIAL² | PARTIAL² | READ_ONLY² | READ_ONLY² | PARTIAL² |
| Ad group / ad set discovery | PARTIAL³ | PARTIAL³ | PARTIAL³ | MISSING | PARTIAL³ | PARTIAL³ | PARTIAL³ | PARTIAL³ | PARTIAL³ | PARTIAL³ | PARTIAL³ |
| Ad discovery | PARTIAL⁴ | PARTIAL⁴ | PARTIAL⁴ | MISSING | PARTIAL⁴ | PARTIAL⁴ | PARTIAL⁴ | PARTIAL⁴ | PARTIAL⁴ | MISSING | PARTIAL⁴ |
| Creative discovery | PARTIAL⁵ | MISSING | MISSING | MISSING | PARTIAL⁵ | MISSING | MISSING | PARTIAL⁵ | PARTIAL⁵ | MISSING | PARTIAL⁵ |
| Metrics | READ_ONLY⁶ | READ_ONLY⁶ | READ_ONLY⁶ | READ_ONLY⁶ | READ_ONLY⁶ | READ_ONLY⁶ | READ_ONLY⁶ | READ_ONLY⁶ | PARTIAL⁶ | READ_ONLY⁶ | PARTIAL⁶ |
| Breakdowns (any dimension) | PARTIAL⁷ | PARTIAL⁷ | PARTIAL⁷ | MISSING | MISSING | MISSING | MISSING | PARTIAL⁷ | MISSING | MISSING | PARTIAL⁷ |
| Audience analysis | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Placement analysis | PARTIAL⁸ | MISSING | PARTIAL⁸ | MISSING | MISSING | MISSING | MISSING | PARTIAL⁸ | MISSING | MISSING | MISSING |
| Geography analysis | PARTIAL⁸ | MISSING | PARTIAL⁸ | MISSING | MISSING | MISSING | MISSING | PARTIAL⁸ | MISSING | MISSING | PARTIAL⁸ |
| Device analysis | PARTIAL⁸ | MISSING | PARTIAL⁸ | MISSING | MISSING | MISSING | MISSING | PARTIAL⁸ | MISSING | MISSING | PARTIAL⁸ |
| Creative analysis | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Budget analysis | PARTIAL⁹ | PARTIAL⁹ | MISSING | MISSING | MISSING | PARTIAL⁹ | MISSING | PARTIAL⁹ | PARTIAL⁹ | MISSING | MISSING |
| Budget pacing | PARTIAL¹⁰ | PARTIAL¹⁰ | MISSING | MISSING | MISSING | PARTIAL¹⁰ | MISSING | PARTIAL¹⁰ | PARTIAL¹⁰ | MISSING | MISSING |
| ROAS | READ_ONLY¹¹ | READ_ONLY¹¹ | READ_ONLY¹¹ | READ_ONLY¹¹ | READ_ONLY¹¹ | READ_ONLY¹¹ | READ_ONLY¹¹ | READ_ONLY¹¹ | MISSING | READ_ONLY¹¹ | MISSING |
| CPA | READ_ONLY¹² | READ_ONLY¹² | READ_ONLY¹² | READ_ONLY¹² | READ_ONLY¹² | READ_ONLY¹² | READ_ONLY¹² | READ_ONLY¹² | MISSING | READ_ONLY¹² | READ_ONLY¹² |
| CAC | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| MER | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| LTV | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Profit | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Contribution margin | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Attribution | MISSING¹³ | MISSING¹³ | MISSING¹³ | PARTIAL¹³ | MISSING¹³ | MISSING¹³ | PARTIAL¹³ | MISSING¹³ | MISSING¹³ | MISSING¹³ | MISSING¹³ |
| Conversion lag | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ | MOCK¹⁴ |
| Creative fatigue | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Anomaly detection | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ | PARTIAL¹⁵ |
| Forecasting | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Budget recommendation | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ | PARTIAL¹⁶ |
| Campaign pause recommendation | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ | PARTIAL¹⁷ |
| Scale recommendation | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Creative recommendation | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Cross-channel allocation | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Business data integration | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Store revenue | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Inventory awareness | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Promotion awareness | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING |
| Historical learning | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ | MISSING¹⁸ |
| Recommendation tracking | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ | MISSING¹⁹ |
| Outcome tracking | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ | MISSING²⁰ |

## Evidence footnotes (every FULL / PARTIAL / READ_ONLY / MOCK cell)

Paths are relative to `/home/user/markting-ai`. "spot-checked" = A16 re-opened the file this audit.

1. **Account discovery.** All channels enumerate accounts only at OAuth time; cloud never re-enumerates and filters to the enabled set (`platform/apps/cloud/lib/cloud/account-scope.ts:68-72`, spot-checked — `listAccounts()` returns `this.accounts.filter(a => this.allowed.has(a.id))`). READ_ONLY where the discovery is complete: Google MCC walk (`platform/packages/google/src/provider.ts:62-128`, A2), Snapchat org→account dedup (`platform/packages/snapchat/src/provider.ts:210-220`, A4), LinkedIn search+cursor (`platform/packages/linkedin/src/provider.ts:47-49`, A5). PARTIAL where fields are dropped: Meta (no timezone/spend_cap/balance, `platform/packages/meta/src/provider.ts:93-107`, A1), TikTok (timezone fetched then dropped, capped at 100, `platform/packages/tiktok/src/provider.ts:76-97`, A3), Microsoft (capped 100, no paging, A8-06), Pinterest/Reddit/X/Spotify/Apple (A6/A9/A7/A10/A11; Apple has no currency/timezone, `platform/packages/apple/src/provider.ts:110-120`).
2. **Campaign discovery.** READ_ONLY (strong for the fields read): LinkedIn all 8 statuses (A5), X with deleted+draft, cursor-safe (A7 `entities.ts:18-25`), Spotify paged list with stall detection (A10 `provider.ts:40-58`). PARTIAL elsewhere: Meta has no typed list, only generic `meta_api_read edge=campaigns` (A1 `tools.ts:58-76`); TikTok page-1-only, 100 rows (A3 `provider.ts:211-219`); Google/Microsoft/Pinterest/Reddit/Apple return id/name/status with no bidding/budget/schedule interpretation (A2/A8/A6/A9/A11).
3. **Ad group / ad set discovery.** PARTIAL = reachable only through the generic raw read path with no typing/normalization (Meta `edge=adsets`, A1; TikTok `adgroup/get`, A3 `tools.ts:144-157`; Microsoft `AdGroups/QueryByCampaignId`, A8; Reddit/Apple raw query, A9/A11; LinkedIn lists campaign-groups but cannot report on them, A5 `provider.ts:60-64,71`; X line items internal only, A7). MISSING for Snapchat — no ad-squad endpoint call at all (A4 `provider.ts:198,260`).
4. **Ad discovery.** PARTIAL = ad entities appear only as report rows or raw reads, usually ID-only (Google name is literally `ad <id>`, A2 `provider.ts:224`, corroborated by A14-02). MISSING for Snapchat (breakdown IDs only, A4) and Spotify (no ad list/get tool, A10).
5. **Creative discovery.** PARTIAL = creative metadata reachable *only* through raw passthrough that no markting surface consumes (Meta `edge=adcreatives` id/name only, A1/A14-08; Microsoft `AdExtensions*/Get*`, A8; Reddit `structured_posts/{id}`, A9 `provider.ts:426`; X media-creative ids, A7; Apple `creatives/query`/`assets/query` allowlisted, A11 `provider.ts:85-86`). MISSING where not even a raw path exists (Google no asset handling, A2; TikTok description-mention only, A3 `tools.ts:150`; Snapchat none, A4; LinkedIn none, A5; Pinterest no `/pins`, A6; Spotify none, A10). Confirmed by A14-01: no creative entity/attribute/table exists anywhere (`platform/packages/core/src/model.ts` has no creative field; engine `domain/metrics.py:49` `PerformanceRow` has no creative/hook/angle field — spot-checked).
6. **Metrics.** READ_ONLY: a fixed vocabulary of 5 base + 5 derived metrics per provider, computed client-side. Spot-checked mappings: Meta conversions=`omni_purchase`, zero-coerced cpa/roas (`platform/packages/meta/src/provider.ts:201-215`); Google `cost_micros/impressions/clicks/conversions/conversions_value` (`platform/packages/google/src/provider.ts:27-33`); TikTok conversion_value=`total_complete_payment_rate` (`platform/packages/tiktok/src/provider.ts:152-153`, code comment confirms misnomer); Snapchat clicks=swipes, conversions=`conversion_purchases` (`platform/packages/snapchat/src/provider.ts:139`); Microsoft conversions=`Conversions`, value=`Revenue` (`platform/packages/microsoft/src/provider.ts:224-240`); LinkedIn conversions=`externalWebsiteConversions` (`platform/packages/linkedin/src/provider.ts:7`); Pinterest conversions=`TOTAL_CHECKOUT` (`platform/packages/pinterest/src/provider.ts:17`); Reddit conversions=purchase clicks+views, value/100 (`platform/packages/reddit/src/provider.ts:230-231`); Spotify conversions=`PURCHASES`, value=`REVENUE` (`platform/packages/spotify/src/provider.ts:16`). PARTIAL for X — the provider *refuses* conversion/value/cpa/roas: "conversion normalization is not yet verified" (`platform/packages/x/src/provider.ts:35`, spot-checked); and Apple — `conversion_value: 0`, `roas: 0` emitted as real numbers (`platform/packages/apple/src/provider.ts:200,211`, spot-checked; A11-03).
7. **Breakdowns (any dimension).** PARTIAL = segmentation reachable only by hand-built params on a raw tool, untested, consumed by no rule (Meta `breakdowns` passthrough, 0 tests, A1 `provider.ts:251`; TikTok `report_type: AUDIENCE` only via `tiktok_api_read`, A3; Reddit `reddit_report.breakdowns` max 4, unvalidated, A9 `tools.ts:232`; Apple raw `groupBy`, A11; Google only via raw GAQL SQL, A2). MISSING where even the raw path has no breakdown dimension (Snap `granularity=TOTAL`, A4; Microsoft `Aggregation: 'Summary'`, A8; LinkedIn `timeGranularity: 'ALL'` hard-coded, A5 `provider.ts:91`; Pinterest `granularity=TOTAL`, A6; X granularity literal `TOTAL`, A7; Spotify `granularity: 'LIFETIME'`, A10).
8. **Placement / Geography / Device analysis.** PARTIAL = available only as a raw `groupBy`/`breakdowns` dimension with no typed tool, no test, no normalization, no analysis rule consuming it (Meta publisher/platform/region/device via raw `breakdowns`, A1; TikTok AUDIENCE report via raw, A3; Reddit raw breakdowns, A9; Apple raw `groupBy countryOrRegion/adminArea/deviceClass/ageRange/gender`, A11 `provider.ts:173-179`). All other channels MISSING (no dimension parameter exists; same evidence as footnote 7). No channel has true Audience analysis (reach/overlap/saturation) — all MISSING (A1-16/A2/A3.../A11, uniformly).
9. **Budget analysis.** PARTIAL only inside the engine, which reads `daily_budget` from `list_campaigns` and computes share-of-spend (`engine` `summary.py:88-104`, A15; A1 notes platform reads never surface budget/cap). Applies to the five platforms the engine normalizes (Meta, Google, Reddit, LinkedIn, X — see `engine` `normalize.py` `PERFORMANCE_PLATFORMS`, spot-checked: GOOGLE_ADS, META_ADS, REDDIT_ADS, LINKEDIN_ADS, X_ADS, OPENAI_ADS). Platform-side budget is read only inside write planners, never in reports (A2 `provider.ts:853-862`), so TikTok/Snap/MS/Pinterest/Spotify/Apple are MISSING.
10. **Budget pacing.** PARTIAL = engine `summarize_window` avg-daily-spend ÷ daily-budget (`engine` `summary.py:88-104,145-147`, A15); limited by the active-day denominator bug (A15-07) and only for the five engine-normalizable platforms. MISSING for the six the engine cannot normalize.
11. **ROAS.** READ_ONLY = per-row `roas = conversion_value / spend` derived by each provider (spot-checked in footnote 6). Platform-attributed only; not business ROAS. X MISSING (conversions refused, footnote 6); Apple MISSING (`roas: 0` hard-coded, `platform/packages/apple/src/provider.ts:211`). Cross-platform blended ROAS is produced by `engine` `compute.py:_combine` (spot-checked: sums `conversion_value` and `spend` across platforms, then `roas=_ratio(...)`) but is semantically unsound (A12-04/A13-01) and the cloud overview ROAS tile is structurally `0×` because `conversion_value` is never requested (`platform/apps/cloud/lib/cloud/reads.ts:54`, spot-checked — metrics list is `['spend','impressions','clicks','conversions','roas']`, no `conversion_value`; A12-01/A13-06).
12. **CPA.** READ_ONLY = per-row `cpa = spend / conversions` (footnote 6). X MISSING (no conversions). Apple READ_ONLY but it is cost-per-install (conversions=`totalInstalls`, tap+view, `platform/packages/apple/src/provider.ts:200`). Same cross-platform-blend caveat as ROAS (A13-10/A13-11).
13. **Attribution.** PARTIAL only for Snapchat (hard-coded 28-day swipe / 1-day view, documented, `platform/packages/snapchat/src/provider.ts` fixed window; A4-06/A13) and Pinterest (fixed 30-click/1-view/default-30-engagement, `platform/packages/pinterest/src/provider.ts:92`; A6-05/A13). MISSING for all others: no attribution window is sent or recorded, `ReportRow`/`PerformanceRow` carry no attribution field, and the engine sums conversions across providers with different windows (A13-01/A13-05, confirmed: `engine` `normalize.py` `_CONVERSION_KEYS = ("conversions","purchases","results")` treats distinct events as one — spot-checked; cross-channel dedup documented as not done, `engine/.../reporting-semantics.md:31`).
14. **Conversion lag.** MOCK everywhere: `data_complete_through` is set only by fixtures (`engine` `fixtures.py:201-214,366`), never by any live provider path (A13-03). In live mode the system cannot tell a buyer a window is still maturing.
15. **Anomaly detection.** PARTIAL for all channels via the generic adport audit pack (`platform/packages/core/src/audit/packs/core-performance.ts` — `zero-conversion-spend`, `low-ctr`, `cpa-outlier`, `negative-roas`; `negativeRoas` spot-checked, filters `roas < 1` with no significance test and `isActive` status filter). Engine adds a ±50% day-over-day flag (`summary.py:120-124`). Caveats: campaign-grain only, no statistical significance (A15, `anomaly-and-significance.md:21-24`), objective-blind for Meta (A1-03), and paused campaigns mis-treated as active for TikTok/Reddit/others because report rows omit status (A3-06/A1-09).
16. **Budget recommendation.** PARTIAL = qualitative only. The audit pack's `negative-roas` rule recommends "consider bid/budget reduction" (`core-performance.ts:95`, spot-checked) and engine pacing flags `over_budget` (`summary.py:145-147`); these run on every channel's rows. But there is no budget-sizing, optimization, marginal-ROAS or diminishing-returns logic anywhere (A15-06, grep: no matches), and the demo path replays a hard-coded Google proposal (A14-05/A15 `demo_script.py:166`). Writes themselves are policy-gated (A1/A2/.../A11 `guardedWriteTool`) but that is execution, not recommendation.
17. **Campaign pause recommendation.** PARTIAL = the `zero-conversion-spend` and `negative-roas` rules surface pause-shaped findings for every channel, and the engine→adport bridge can route a pause (`platform/apps/cloud/lib/markting/translate.ts` `pauseCampaign`). Same caveats as footnote 15; and because conversions are zero-coerced (A13-04/A1-03), the pause rule can fire on healthy non-purchase-objective campaigns.
18. **Historical learning.** MISSING as a learning loop. Period-over-period comparison does exist (`engine` `compute.py:98-114,375-422` `compare_periods`, A15) for the five engine-normalizable platforms, but nothing stores past recommendations or their results to inform future decisions (A12/A15: no such store).
19. **Recommendation tracking.** MISSING. The policy engine keeps an append-only audit log of *executed, approved writes* (`platform/packages/core/src/policy/engine.ts`), not of recommendations offered, declined, or still open. No table links a recommendation to a tenant decision.
20. **Outcome tracking.** MISSING. Nothing closes the loop from an applied action to its measured effect; there is no action→result join anywhere (A12/A15).

## How to read this matrix as a buyer

- **Reporting (rows 1–6, ROAS, CPA):** a buyer can pull spend/impressions/clicks/conversions/value and the five
  derived ratios per channel, at campaign grain, as last-touch platform-attributed numbers. That is the ceiling.
- **Diagnosis (breakdowns, audience, placement, geo, device, creative, fatigue, attribution):** effectively
  unavailable. Where data is technically reachable it is raw-passthrough, untested, and consumed by nothing.
- **Economics (CAC, MER, LTV, profit, contribution margin, store revenue, inventory, promotion):** entirely
  absent. The product optimizes platform-reported conversion value, which is not the business's money.
- **Action (budget/pause recommendation):** crude, generic, qualitative, and can fire on false signals
  (zero-coerced conversions, status-blind rows). Scale, creative, and cross-channel allocation: absent.
- **Memory (historical learning, recommendation/outcome tracking):** absent — the system does not learn.
