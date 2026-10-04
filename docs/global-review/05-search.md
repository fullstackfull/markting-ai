# Product-Maturity Review 05 — Paid Search / Google Ads Specialist

**Reviewer role:** Senior Google Ads / paid-search specialist (independent).
**Scope:** Is MARKTING-AI a credible global search-specialist tool, or is it Meta-centric with Google bolted on?
**Method:** Grounded read of `platform/packages/google/src/{provider,tools,client,index}.ts`, the shared model (`platform/packages/core/src/model.ts`), the orchestrator sections/breakdown/benchmark, and the dashboard surfaces. Every claim cites code. No external research was required; nothing here is marked UNVERIFIED_EXTERNAL_RESEARCH_REQUIRED.

---

## 1. Executive summary

MARKTING-AI's Google adapter is a **competent, honest, but deliberately shallow write/exec harness over the Google Ads v25 REST API**. It can create and mutate the core search objects (campaigns, ad groups, keywords, RSAs, bidding strategies) and run arbitrary GAQL reads. What it is **not** is a *search-intelligence product*: none of the concepts a search specialist lives in day-to-day — search terms, impression share, quality signals, negative-keyword workflows, PMax asset groups, Shopping/feed health — are modeled, normalized, surfaced in a dashboard, or reasoned about by the assistant/orchestrator. They are reachable, if at all, only as raw GAQL passthrough that a human or external agent must hand-write.

The product's own internal acceptance benchmark (`platform/apps/cloud/lib/markting/orchestrator/benchmark.ts`) is refreshingly candid and confirms this: the four canonical search questions (top search terms, negatives to add, impression share / lost IS, PMax by asset group) are all classified `agent-only` or `none` with reasons `REQUIRES_PROVIDER_CAPABILITY` / `NOT_SUPPORTED_BY_PRODUCT`.

The intelligence layer (diagnosis, pacing, saturation, breakdowns, creative fatigue, frequency) is built around **Meta-native concepts** — placement, audience segment, creative fatigue, frequency saturation — and a normalized metric set that is the Meta/display lowest common denominator. There is no symmetric search-native intelligence. **Verdict: Meta-centric. For a search specialist, this is a secondary execution tool, not a daily search cockpit.**

---

## 2. The normalized model is the ceiling

The entire product reasons over a fixed, generic metric and entity vocabulary. This is the single most important finding, because the dashboards and the AI assistant can only ever expose what the normalized model carries.

`platform/packages/core/src/model.ts`:
- **Metrics (lines 1–13):** `spend, impressions, clicks, conversions, conversion_value, ctr, cpc, cpm, cpa, roas`. That is the complete list. **No** impression share, search impression share, top/abs-top IS, lost IS (budget/rank), quality score, search-term counts, click-share, or any search-auction metric.
- **Entity levels (lines 15–16):** `account, campaign, ad_group, ad`. **No `keyword` level and no `search_term` level.** Keywords and search terms cannot be reported, ranked, or charted through the normalized path at all.

Google's `report()` (`provider.ts:141–182`) maps GAQL only into these generic metrics via `BASE_METRIC_FIELDS` (`provider.ts:27–33` — `cost_micros, impressions, clicks, conversions, conversions_value`). `LEVEL_RESOURCE` (`provider.ts:19–24`) maps only to `customer/campaign/ad_group/ad_group_ad`. So normalized Google reporting stops at the ad level and the five base metrics — identical in shape to every other channel.

**Consequence:** every dashboard metric, every assistant answer, every cross-channel comparison is a generic campaign-metric view. A search specialist's core diagnostic surface (keyword/search-term grain, IS and lost-IS, QS components) is structurally absent, not merely unimplemented.

---

## 3. Per-capability support table

Evidence key: `provider.ts` / `tools.ts` = `platform/packages/google/src/*`; `model.ts` = core model; `benchmark.ts` = orchestrator benchmark.

| # | Capability | Status | Evidence |
|---|-----------|--------|----------|
| 1 | **Campaigns (create/status/report)** | **Supported** | `google_create_campaign` (tools.ts:31–44; provider.ts:385–438, atomic budget+campaign), `google_set_campaign_status` (tools.ts:45–52; provider.ts:440–461), report at campaign level (provider.ts:164–166). |
| 2 | **Ad groups (create/status)** | **Supported** | `google_create_ad_group` (tools.ts:91–102; provider.ts:505–527, forces `type: SEARCH_STANDARD`), `google_set_ad_group_status` (tools.ts:103–110). |
| 3 | **Keywords (add/pause/remove, match types)** | **Supported (write)** | `google_add_keywords` (tools.ts:111–122; provider.ts:551–574), `google_set_keyword_status`, `google_remove_keywords`; `matchTypeSchema = EXACT/PHRASE/BROAD` (tools.ts:6). BUT: no `keyword` entity level in `model.ts`, so **keyword performance cannot be reported/ranked** through the normalized layer — write-only. |
| 4 | **Match types** | **Supported (write)** | `matchTypeSchema` EXACT/PHRASE/BROAD (tools.ts:6, 119). No match-type-level reporting or analysis. |
| 5 | **Negative keywords (add)** | **Partial** | `google_add_keywords` with `negative: true` adds ad-group negatives (provider.ts:551–574). **No campaign/shared negative lists, no negative-keyword *workflow* or suggestion engine** — benchmark q24 "What negatives should I add?" = `NOT_SUPPORTED_BY_PRODUCT` (benchmark.ts:69). |
| 6 | **Search terms / search-query waste** | **Absent (normalized); passthrough-only** | No `search_term_view` normalization, no entity level, no surface. Benchmark q23 "top search terms" = `agent-only`, `REQUIRES_PROVIDER_CAPABILITY` (benchmark.ts:68). Reachable only by hand-writing GAQL via `google_gaql` (tools.ts:10–30). |
| 7 | **Bidding strategies** | **Supported (write)** | `google_set_bidding_strategy` MANUAL_CPC / MAXIMIZE_CLICKS / MAXIMIZE_CONVERSIONS(+tCPA) / MAXIMIZE_CONVERSION_VALUE(+tROAS) (tools.ts:74–90; provider.ts:707–780); `google_set_bid_ceiling` for TARGET_SPEND & TARGET_IMPRESSION_SHARE (provider.ts:664–705). Solid. Note tCPA/tROAS only as targets on Maximize strategies; no standalone Target CPA/Target ROAS portfolio strategies, no Target Impression Share *strategy* creation (only ceiling edit on an existing one). |
| 8 | **Budgets** | **Supported** | `google_set_budget` with shared-budget warning (provider.ts:463–503), atomic non-shared budget on create, policy-checked budget deltas (provider.ts:875–886). Good. |
| 9 | **Conversion actions** | **Absent (normalized); passthrough-only** | No conversion-action tool, no tracking/import setup, no conversion-action read in the model. Only aggregate `conversions`/`conversion_value` metrics. Any conversion config would be raw `google_api_create` on an undocumented service. |
| 10 | **Performance Max** | **Absent (beyond a channel enum)** | `channel_type` enum allows `PERFORMANCE_MAX` on create (tools.ts:41) but there is **no asset-group, listing-group, audience-signal, or asset handling**. Benchmark q26 "PMax by asset group" = `REQUIRES_PROVIDER_CAPABILITY` (benchmark.ts:71). Effectively unusable for PMax. |
| 11 | **Shopping** | **Absent (beyond a channel enum)** | `SHOPPING` appears only in the `channel_type` enum (tools.ts:41). No product groups, listing-group partitions, or Shopping-specific reporting. `grep shopping` in `packages/google/src` returns only that enum line. |
| 12 | **Feeds / Merchant Center** | **Absent** | No Merchant Center, product feed, feed-health, or disapproval handling anywhere in `packages/google`. |
| 13 | **Impression share / quality signals** | **Absent (normalized); passthrough-only** | No IS/lost-IS/QS metric in `model.ts`. `TARGET_IMPRESSION_SHARE` is referenced **only** as a bid-ceiling target (provider.ts:664–705), not as a reported metric. Benchmark q25 "Search IS / lost IS" = `agent-only`, not normalized (benchmark.ts:70). No quality-score read at all. |
| 14 | **RSAs / search ads** | **Supported** | `google_create_responsive_search_ad` with client-side validation (3–15 headlines ≤30, 2–4 descriptions ≤90) (tools.ts:140–154; provider.ts:622–662, 839–849). Good execution primitive. No ad-strength read, no asset-level reporting. |
| 15 | **Pacing** | **Partial / generic** | A `pacing` section exists (benchmark q13; `sections.ts`), but it is a generic budget-elapsed-vs-spent model driven by seeded/normalized spend, not Google-budget-specific (shared budgets, bid-strategy learning). Channel-agnostic. |
| 16 | **Experiments / drafts** | **Absent (as a Google feature)** | The "experiments" section (`sections.ts:231–235`, `buildExperiments`) is a **review/design workbench reading `acc.experiments` seed data** — it is NOT the Google Ads Drafts & Experiments API. Nothing is created or measured on Google. Benchmark q49 is the generic workbench. |
| 17 | **Raw GAQL read (escape hatch)** | **Supported** | `google_gaql` passthrough — any resource, fields, conditions, order (tools.ts:10–30; provider.ts:236–250). This is the *only* way to touch search terms / IS / PMax, and it returns raw rows the product does not interpret. |
| 18 | **Generic v25 mutate escape hatch** | **Supported** | `google_api_create/update/remove` reach any v25 service (tools.ts:155–193; provider.ts:310–383), with cross-customer reference guards and budget-update interception. Powerful but unopinionated — no search semantics. |

---

## 4. Dimension scores (0–5)

| Dimension | Score | Rationale |
|-----------|:---:|-----------|
| Campaign structure management (campaign/adgroup/keyword/ad CRUD) | **4** | All four create/mutate paths exist and are well-guarded; atomic budget+campaign is a nice touch. Loses a point: keyword level is write-only (no reporting), no shared negative lists. |
| Bidding & budget control | **4** | Full strategy switching, tCPA/tROAS targets, bid ceilings, shared-budget warnings, policy-checked deltas. Loses a point: no portfolio bid strategies, no TIS strategy creation. |
| Search-term & negative-keyword workflow | **1** | Can add ad-group negatives; cannot see search terms, cannot suggest negatives, no n-gram/waste analysis. Benchmark q23/q24 confirm agent-only / not-supported. |
| Impression share & auction insights | **0** | Not in the metric model; only a bid-ceiling target reference. No IS, lost IS, auction insights, or top-of-page rate. |
| Quality signals (Quality Score, ad strength) | **0** | No quality score, ad strength, or component reads anywhere. |
| Shopping / feeds / Merchant Center | **0** | Only a `SHOPPING` channel enum string. No product/feed/MC support. |
| Performance Max | **0.5** | Only a `PERFORMANCE_MAX` channel enum; no asset groups, signals, or listing groups. |
| Conversion tracking configuration | **1** | Aggregate conversion metrics only; no conversion-action management or import. |
| Experiments / drafts (Google-native) | **1** | Generic review workbench on seed data; not the Google experiments API. |
| Pacing & forecasting | **3** | Generic but functional pacing + forecast sections; channel-agnostic, not search-aware. |
| Search-specific reporting surfaces in dashboards | **1** | Dashboards show normalized spend/CPA/ROAS/CTR only (`reports/engine-reports.tsx:11` surfaces spend & CPA deltas). No keyword, search-term, IS, or QS columns. |
| Raw API reach / escape hatch | **5** | `google_gaql` + generic v25 mutate reach everything the API offers, with good error formatting (`client.ts:189–212`) and cross-customer guards. |
| Honesty about gaps | **5** | `benchmark.ts` explicitly and correctly labels every unsupported search capability with a reason. Exemplary. |

**Search-specialist weighted average ≈ 1.9 / 5.**

---

## 5. Meta-centrism assessment

The evidence that the intelligence layer is built for Meta and merely *tolerates* Google:

1. **Normalized metric set is the Meta/social LCD.** `model.ts` carries no search-auction metric. The shared vocabulary cannot express a search specialist's world, but expresses Meta's (spend/impr/clicks/conv/value/ctr/cpc/cpm/cpa/roas) fully.
2. **Breakdown engine dimensions are Meta-native.** `sections.ts:326–333` — "placement / device / geography / audience". `placement` and `audience_segment` are Meta/social constructs; there is **no `search_term` or `keyword` breakdown dimension**. Benchmark q22 ("best placements") and q35 ("audiences that convert") are first-class; q23 ("top search terms") is agent-only.
3. **Creative intelligence is Meta-shaped.** Creative fatigue, hooks/cluster, frequency saturation (benchmark q19–21, q50; saturation section is "frequency-aware"). Frequency and creative fatigue are social-feed concepts; there is no RSA ad-strength or asset-performance equivalent for search.
4. **Richer Meta read surface.** Meta ships dedicated `meta_insights` with a native `breakdowns` param, plus `meta_page_engagement` and `meta_list_pages` (`packages/meta/src/tools.ts:31–100`). Google's only structured read is the generic `google_gaql` passthrough — no curated search reads (no search-terms tool, no IS tool, no keyword-performance tool).
5. **The benchmark's "not-now" set is almost entirely Google-search.** Of the capability gaps, the search items (q23 search terms, q24 negatives, q25 IS, q26 PMax) cluster as `REQUIRES_PROVIDER_CAPABILITY` / `NOT_SUPPORTED_BY_PRODUCT`, while the Meta-flavored questions (placements, audiences, frequency, creative fatigue) are answerable now.

**Counter-evidence (fairness):** the *write/execution* harness for Google is genuinely strong and arguably more structured than Meta's in places (atomic budget+campaign, typed bidding-strategy tool, RSA client-side validation, bid-ceiling strategy awareness). Google is not an afterthought in the *mutation* layer. The asymmetry is entirely in **reading and reasoning** — which is exactly where a search specialist spends their time.

**Conclusion: Yes, the product is Meta-centric in its intelligence and reporting.** Google is a well-built execution target bolted onto a Meta-shaped brain.

---

## 6. Verdict on global search-specialist credibility

As a **governed execution layer** for Google Ads — pushing reviewed campaign/ad-group/keyword/RSA/bid/budget changes with dry-run previews and policy guards — MARKTING-AI is credible and better-engineered than most. As a **search-specialist analysis and optimization product**, it is not credible: the daily work of a search buyer (mining search terms, building negatives, defending impression share, policing quality signals, managing Shopping feeds and PMax asset groups) is either entirely absent or demoted to hand-written GAQL the product won't interpret.

A search specialist could use it to *apply* changes they decided on elsewhere, and to get generic cross-channel spend/ROAS context. They could not use it to *decide* what to do in search. The product knows this and says so in its own benchmark — which earns trust even as it confirms the gap.

**Final verdict: WOULD_USE_AS_SECONDARY_TOOL** — an execution and portfolio-overview companion alongside the Google Ads UI / Editor, not a replacement for a search cockpit.

---

## 7. Top recommendations (for the council)

1. **Add `keyword` and `search_term` entity levels** to `model.ts` and a curated `google_search_terms` read — this unlocks the single highest-value search workflow.
2. **Normalize impression-share metrics** (search IS, lost IS budget/rank, top/abs-top) into the metric model or at least a dedicated IS read; add a surface tile.
3. **Build a negative-keyword suggestion engine** (n-gram waste over search terms) — currently `NOT_SUPPORTED_BY_PRODUCT`.
4. **Decide on PMax/Shopping**: either support asset groups + listing groups + feed health, or stop advertising those channel enums as if supported.
5. **Add a search-term / keyword breakdown dimension** to the breakdown engine to reach parity with the Meta placement/audience dimensions.
