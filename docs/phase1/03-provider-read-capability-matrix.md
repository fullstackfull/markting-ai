# 03 — Provider read-capability matrix (audited)

Honest, code-grounded audit of what each provider's `report()` + read methods actually implement
today. All normalized reads flow through `listAccounts()` and `report(NormalizedQuery)` → `ReportRow`;
creatives/audiences/breakdowns exist only as per-provider extra tools (generic `*_api_read`, GAQL,
insights) and do NOT reach the normalized path. Classifications: FULL / PART / MISS / UNSUP
(provider) / BLOCK (api access).

| provider | accounts | campaigns | adgroups | ads | creatives | metrics | breakdowns | audiences | conversions | budget-read | status-read |
|---|---|---|---|---|---|---|---|---|---|---|---|
| meta | FULL | FULL | FULL | FULL | PART | 10/10 | PART (meta_insights) | PART (api_read) | FULL | PART (api_read) | PART (api_read only) |
| google | FULL | FULL | FULL | FULL | PART | 10/10 | PART (GAQL) | PART (GAQL) | FULL | PART (GAQL) | FULL |
| tiktok | FULL | FULL | FULL | FULL | PART | 10/10 | PART (tiktok_report) | PART | FULL | PART (tiktok_campaigns) | PART |
| snapchat | FULL | PART (id-as-name) | PART | PART | MISS | 10/10 | MISS | MISS | FULL | PART | PART |
| microsoft | FULL | FULL | UNSUP(v0 throws) | UNSUP(v0 throws) | PART | 10/10 | MISS | PART | FULL | PART | FULL |
| linkedin | FULL | FULL | UNSUP | PART | PART | 10/10 | MISS | MISS | FULL | PART | FULL |
| pinterest | FULL | FULL | FULL | FULL | PART | 10/10 | MISS | MISS | FULL | PART | FULL |
| reddit | FULL | PART (id-as-name) | PART | PART | PART | 10/10 | PART (rawReport) | PART | FULL | PART | PART |
| x | FULL (no ccy) | FULL | FULL | PART | PART | 6/10 | MISS | MISS | UNSUP (not normalized) | PART | FULL |
| spotify | FULL | FULL | FULL | FULL | PART | 10/10 | MISS | MISS | FULL | PART | FULL |
| apple | FULL (no ccy) | FULL | UNSUP(v0 throws) | UNSUP(v0 throws) | PART | 8/10 | PART (api_read) | UNSUP | PART (installs) | PART | FULL |

## Priority providers (deep correctness first): meta, google, tiktok, snapchat
- **meta** — `report()` omits `entity.status` and budget; add `effective_status` to the insights
  fetch and set `status` in `toReportRow` (`meta/src/provider.ts:180`, `:223-230`).
- **google** — most complete (all levels, status everywhere, GAQL escape hatch); only typed breakdown/
  audience reads are missing and GAQL already covers them.
- **tiktok** — `report()` drops status and discards `complete_payment_roas`; map both
  (`tiktok/src/provider.ts:118-127`, `:164`, `:170-174`).
- **snapchat** — sub-level rows use id-as-name and have no status; join `listCampaigns` metadata into
  `report()` (`snapchat/src/provider.ts:75-79`).

## Highest-value small missing reads (prioritized; deferred to Gate-A hardening)
1. Populate `entity.status` in meta/tiktok report rows (pure mapping; unblocks status filtering).
2. Snapchat sub-level real names (join listCampaigns).
3. TikTok: stop discarding `complete_payment_roas` (trivial, improves ROAS fidelity).
4. Label pinterest/spotify/linkedin ad-level metrics as creative reads (naming only).
5. microsoft/apple ad_group report level (currently throws; larger — new report shape).

These are small provider edits that improve read parity; they are NOT blockers for the intelligence
foundation (which already consumes the campaign-level + 5-metric reads the dashboard uses). They are
staged as Gate-A read-parity hardening to avoid a broad multi-provider change mid-phase. No provider
was given faked parity.
