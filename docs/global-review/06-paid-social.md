# 06 — Paid Social Specialist Review (Meta / TikTok / Snapchat / Pinterest)

Independent reviewer: paid-social specialist. Council: MARKTING-AI product-maturity.
Date: 2026-10-04. Every claim below is grounded in repository code with file:line citations.
Nothing is assumed; where a capability is absent I say so and show the absence.

---

## TL;DR

MARKTING-AI's provider adapters are **thin, correct, generic-metric normalizers**. Every one of
the four paid-social providers collapses to the **same 10 metrics** —
`spend, impressions, clicks, conversions, conversion_value, ctr, cpc, cpm, cpa, roas`
(`platform/packages/core/src/model.ts:1-13`). There is **no frequency, no reach, no placement, no
video/thruplay, no learning-phase, no audience dimension** in the normalized model.

There *is* a genuinely sophisticated, epistemically honest **intelligence layer** (pacing,
scaling, response-curve/saturation, creative-fatigue, placement-breakdown, budget-allocation
engines) under `platform/apps/cloud/lib/markting/`. These engines understand paid social well on
paper. **But they are wired only to synthetic sandbox fixtures.** In any live deployment the data
source is the `emptyGatherer`, which returns `NOT_CONNECTED` and produces **no analytical sections
at all** (`platform/apps/cloud/lib/cloud/intelligence.ts:45-47`). Every rich dashboard
(creative, breakdown, pacing, campaign detail) renders an **empty state** with real accounts
connected.

**Net:** the product *designs for* paid-social depth but, with live data, currently only
*normalizes* generic spend/ROAS/CPA rollups. The depth is a demo.

---

## How the data actually flows (the load-bearing finding)

1. **Provider report path** (live-capable): each provider's `report()` returns `ReportRow`s with
   `metrics: Partial<Record<MetricName, number>>` — the 10 generic metrics only.
   - Meta: `platform/packages/meta/src/provider.ts:429-465` (`toReportRow`) — derives from
     `spend/impressions/clicks/actions(omni_purchase)/action_values`.
   - TikTok: `platform/packages/tiktok/src/provider.ts:136-174`.
   - Snapchat: `platform/packages/snapchat/src/provider.ts:116-149` (`normalize`).
   - Pinterest: `platform/packages/pinterest/src/provider.ts:166-181` (`normalize`).
   None of these capture frequency, reach, placement, or any social-native dimension.

2. **Intelligence layer** consumes rich inputs (`frequency`, `ctrSeries`, placement `BreakdownRow[]`,
   response-curve points) that the report path never produces.

3. **The bridge between them does not exist for live data.** The only two gatherers are:
   - `demoGatherer` — "deterministic, CLEARLY SYNTHETIC" fixtures; all trust tiers `SYNTHETIC`
     (`platform/apps/cloud/lib/markting/orchestrator/demo-gatherer.ts:1-31`).
   - `emptyGatherer` — returns `NOT_CONNECTED`/`NO_SIGNAL` and **no `sections()`**
     (`demo-gatherer.ts:20-28`).
   Selection: `serviceForMode()` → `isDemoMode() ? demoGatherer : emptyGatherer`
   (`platform/apps/cloud/lib/cloud/intelligence.ts:45-47`).
   The rich analytical `sections()` method (pacing/breakdown/creative/saturation) exists **only on
   the demo gatherer** (`demo-gatherer.ts:30-33`), sourced from `seedClientForAccount` +
   `SEED_PORTFOLIO` (`platform/apps/cloud/lib/markting/orchestrator/seed.ts`).

4. **Live dashboards fall through to empty.** `loadCampaign`, `loadCreativeDetail`,
   `loadCampaignList` all short-circuit when not in demo mode:
   `"No live provider connected — connect a provider to view campaign detail."`
   (`platform/apps/cloud/lib/cloud/intelligence.ts:62-90`). The creative dashboard renders
   `<Empty>` when `a.section` is absent (`platform/apps/cloud/app/dashboard/creative/page.tsx:18-21`),
   which is the live case. Executive/experiments dashboards call the same `loadSection`
   (`.../dashboard/executive/page.tsx:14-16`, `.../dashboard/experiments/page.tsx:13-15`).

There is a defense-in-depth guard that *verifies synthetic data never leaks into a live surface*
(`intelligence.ts:19-23`) — commendable, but it confirms the architecture: live = empty, demo = rich.

---

## Dimension-by-dimension evidence & scores (0–5)

### 1. Hierarchy fidelity — **2 / 5**
- **Read**: all four levels modeled (`account/campaign/ad_group/ad`,
  `platform/packages/core/src/model.ts:15-16`); each provider maps the level to the native
  reporting enum (Meta `INSIGHTS_LEVEL`, TikTok `DATA_LEVEL`, Snapchat `BREAKDOWN`, Pinterest `LEVEL`).
  Good.
- **Write**: shallow and uneven. Meta exposes campaign + ad set typed writes plus a generic
  `meta_api_create/update/delete` over any edge (`platform/packages/meta/src/tools.ts:102-224`).
  TikTok exposes campaign writes + generic `/create|/update|/delete` passthrough
  (`platform/packages/tiktok/src/tools.ts`). **Snapchat and Pinterest expose campaign-level ONLY**
  — `list_campaigns, create_campaign, set_campaign_status, set_budget` and nothing for ad
  squads/ad groups, ads, or creatives, with no generic passthrough
  (`platform/packages/snapchat/src/tools.ts`, `platform/packages/pinterest/src/tools.ts`).
- A paid-social buyer lives at the ad-set/ad-group and ad level (targeting, bids, creatives).
  Typed support for that tier barely exists.

### 2. Creative intelligence — **1 / 5**
- The engine (`platform/apps/cloud/lib/markting/intelligence/creative.ts`) is thoughtful: spend
  HHI concentration, CPA dispersion, and a fatigue verdict that is explicitly
  `FATIGUE_SIGNAL | NOT_PROVEN | NO_SIGNAL | INSUFFICIENT_DATA` and treats ad copy as *data only*.
  Multimodal is always `MULTIMODAL_NOT_CONFIGURED` (`orchestrator/sections.ts:189`).
- **No provider fetches creative-level data.** There is no ad-creative read, no asset/thumbnail,
  no video retention metric in any adapter. `Creative`/`CreativePerformance` carry `frequency`,
  `ctrSeries`, `placements` (`.../creative/model.ts:55-83`) but nothing live populates them.
  Live creative detail returns "No live provider connected" (`intelligence.ts:79-82`).

### 3. Placements / breakdowns — **1 / 5**
- Best-designed analytical module: `analyzeBreakdown` with a per-provider support matrix and a
  **protected-dimension safety rule** (age/gender reported but never turned into a targeting
  exclusion) (`platform/apps/cloud/lib/markting/intelligence/audience.ts:10-84`).
- But it takes `BreakdownRow[]` as input and **nothing fetches those rows from a provider.** The
  only caller is `buildBreakdown(acc)` reading `acc.breakdowns` from the seed
  (`orchestrator/sections.ts:328-333`; seed rows at `orchestrator/seed.ts:208-217`).
- Meta's raw `meta_insights` tool *does* accept a `breakdowns` passthrough
  (`platform/packages/meta/src/tools.ts:93`, `provider.ts:484`) — an agent could request
  `publisher_platform`/`platform_position` manually — but it is **not modeled, normalized, or
  wired** into the breakdown engine.

### 4. Audiences / targeting — **1 / 5**
- Essentially absent. The only targeting any typed write supports is **country geo** on a Meta ad
  set (`platform/packages/meta/src/provider.ts:812` → `targeting:{ geo_locations:{ countries }}`).
  No interests, behaviors, custom audiences, lookalikes, retargeting, or exclusions in any typed
  tool. A repo-wide search for `lookalike|custom_audience` returns **0 hits** in source.
- `audience_segment` exists only as a seed breakdown dimension (e.g. "Lookalike 2%",
  `orchestrator/seed.ts:217`), not a real read. Meta `customaudiences` is reachable only through
  the generic `meta_api_read` edge passthrough (`meta/src/tools.ts:67`).

### 5. Frequency / reach — **1 / 5**
- Neither `frequency` nor `reach` is in `METRICS` (`core/src/model.ts:1-13`); no adapter requests
  them. `frequency` appears as a *type field* and in seed `frequencySeries`
  (`orchestrator/seed.ts:45,181-184`) consumed by the fatigue/saturation logic — synthetic only.
  A live account yields no frequency at all.

### 6. Creative fatigue — **2 / 5**
- The reasoning is the strongest fatigue logic I would expect from a mature tool: CTR decline
  gated by frequency context, elevated to `FATIGUE_SIGNAL` only with repetition evidence and
  always labelled not-proven (`creative.ts:85-101`; section-level cross-check of CTR-down +
  frequency-up at `orchestrator/sections.ts:147-191`). Saturation detection mirrors it
  (`sections.ts:89`).
- Docked hard: it runs on `ctrSeries`/`frequencySeries` that **only the seed provides**. No live
  pipeline computes a daily CTR/frequency series from provider data.

### 7. Learning phase — **0 / 5**
- **Not modeled anywhere.** Repo search for `learning phase|learning_phase|LEARNING_LIMITED|
  in_learning` → 0. Meta's `effective_status`/delivery learning is never fetched. TikTok's
  `secondary_status` is typed (`platform/packages/tiktok/src/provider.ts:40`) but **never read or
  interpreted**. The `LEARNING` token that exists is a *creative lifecycle* age state
  (`test/phase4-eval.test.ts:41`), unrelated to platform delivery learning. For a paid-social
  tool, ignoring learning phase is a material blind spot (budget/edit timing, exit-learning,
  learning-limited diagnosis all impossible).

### 8. Attribution windows — **2 / 5**
- Partially deliberate, inconsistent, and not user-controllable:
  - Snapchat hardcodes `swipe_up_attribution_window: '28_DAY', view_attribution_window: '1_DAY'`
    (`platform/packages/snapchat/src/provider.ts:61`).
  - Pinterest hardcodes `click_window_days:'30', view_window_days:'1',
    conversion_report_time:'TIME_OF_AD_ACTION'` (`platform/packages/pinterest/src/provider.ts:92`).
  - Meta sets **no** `action_attribution_windows` → silently uses the API default; TikTok likewise.
- So cross-channel ROAS (`intelligence/cross-channel.ts`) blends **different attribution windows
  per platform with no disclosure**, and the windows are neither configurable nor surfaced. The
  system is *aware* attribution matters (`scaling.ts` has `attributionReliable`; audit pack warns
  on windows, `core/src/audit/packs/core-performance.ts:95`) but does not operationalize it.

### 9. Spend pacing — **2 / 5**
- `analyzePacing` is excellent and honest: separates a **delivery problem** from a **budget
  opportunity**, refuses to treat underpacing as a scale signal, straight-line method explicitly
  labelled, early-period projection guard, timezone math delegated to the caller
  (`platform/apps/cloud/lib/markting/intelligence/pacing.ts:1-93`).
- But fed from `SeedAccount` spend/budget via `buildPacing` (`orchestrator/sections.ts:39-43`).
  Live = empty. Pacing is the most *trivially wireable* of the engines (needs only spend-to-date
  from `report()` + a budget from business context), yet that wiring is not present.

### 10. Scaling & budget movement — **3 / 5**
- The high-water mark of genuine paid-social sophistication, and it is review-only (never executes):
  - `evaluateScalingReadiness` demands **positive performance evidence (beating a known target)** —
    not volume alone — before `READY_FOR_HUMAN_REVIEW`, and gates on sample/stability/attribution/
    freshness/window-complete (`intelligence/scaling.ts:30-70`).
  - `evaluateDownscaleCandidacy` never cuts on one rule and treats low spend as *not* poor
    performance (`scaling.ts:84-116`).
  - `optimize/allocation.ts` is a deterministic greedy marginal-value allocator, role-aware
    (won't rob brand/strategic budgets), **reduces confidence** on saturation, creative fatigue,
    inventory risk, and weak attribution, profit-aware when merchant truth exists, review-only
    (`.../optimize/allocation.ts:1-60`).
  - `optimize/response-curve.ts` fits a simple spend→outcome relationship only with ≥4 spend levels
    and ≥30 conversions, with an explicit validity range it refuses to extrapolate beyond — "NO
    fake ML" (`.../optimize/response-curve.ts:1-48`).
- Docked: the response curve needs historical daily (spend, conversions) points that no live
  pipeline assembles; signals (`saturation`, `creativeFatigue`, `beatingTarget`) come from the
  seed. Still the strongest, safest design in the codebase.

### 11. Social-specific diagnostic depth vs normalization — **2 / 5**
- The verdict dimension. The **provider layer is pure normalization** (10 generic metrics, zero
  social-native fields). The **intelligence layer designs for depth** but executes only on
  synthetic fixtures. With real connected accounts today, a buyer sees spend/ROAS/CPA rollups and
  empty states for every social-native question (frequency, placements, fatigue, learning phase,
  audiences). Credit for design intent and safety; heavy dock for demo-only reality.

---

## Strengths (grounded)

1. **Write safety model is genuinely good.** Server-side `validate_only` previews on Meta
   (`meta/src/provider.ts:504-515`), forced-paused creation, budget deltas surfaced in micros with
   currency-correct conversion, budget updates refused through generic passthrough so they hit a
   typed policy path (`meta/src/provider.ts:612-613`; TikTok `provider.ts:275-281`), ownership
   assertions before every mutate (Meta `assertObjectOwnedByAccount`; Pinterest/Snap account-match
   checks).
2. **Scaling / allocation / response-curve engines are mature and epistemically honest** — target-
   beating required for scale, review-only, no fake ML, validity-bounded (`scaling.ts`,
   `optimize/allocation.ts`, `optimize/response-curve.ts`).
3. **Pacing correctly separates delivery vs budget opportunity** and refuses the classic
   "underpacing → raise budget" error (`intelligence/pacing.ts`).
4. **Breakdown engine encodes protected-dimension ethics** — age/gender reported but never
   converted to a targeting exclusion (`intelligence/audience.ts:13,75-77`).
5. **Honest trust tiering + source isolation** — synthetic data is labelled `SYNTHETIC` and a
   fail-closed guard prevents it reaching a live surface (`cloud/intelligence.ts:19-23`); empty
   live states are truthful, not faked.
6. **Currency discipline** — micros/minor-unit conversions are exponent-aware and never blend
   currencies (`meta/src/provider.ts:644-651`; breakdown/pacing refuse mixed currency).

## Gaps (grounded, in priority order)

1. **No live wiring from providers into the intelligence engines.** Live = `emptyGatherer` →
   every deep surface is empty (`cloud/intelligence.ts:45-47`, `62-90`). This is the single
   finding that caps the product for paid social.
2. **Normalized model omits every social-native dimension** — no frequency, reach, placement,
   video metrics, audience segment (`core/src/model.ts:1-13`). The adapters cannot feed the
   engines even if wired.
3. **Learning phase entirely absent** (0 hits). No learning-limited diagnosis, no edit-timing
   awareness, TikTok `secondary_status` fetched-but-ignored.
4. **Audience/targeting is country-geo only**; no custom audiences, lookalikes, interests,
   retargeting, or exclusions in typed tools (`meta/src/provider.ts:812`).
5. **Attribution windows inconsistent, hardcoded, undisclosed, non-configurable**, and
   cross-channel ROAS silently blends them (`snapchat` 28/1, `pinterest` 30/1, Meta API default).
6. **Hierarchy writes stop at campaign for Snapchat & Pinterest** — no ad set/ad squad/ad/creative
   operations where paid-social work actually happens.
7. **Creative understanding is structural only** — `MULTIMODAL_NOT_CONFIGURED` always; no asset,
   thumbnail, hook, or video-retention ingestion from any provider.

---

## Verdict

**WOULD_PILOT.**

As a paid-social specialist I cannot use this daily: with real accounts connected it normalizes
generic spend/ROAS/CPA and returns empty states for frequency, placements, creative fatigue,
learning phase, audiences, and campaign/creative detail — the substance of the job. The depth that
exists runs only on a synthetic demo seed.

It is not WOULD_NOT_USE, because the foundation is real and unusually disciplined: the write-safety
/ preview / policy model, the pacing and scaling/allocation/response-curve engines, the
protected-dimension and trust-tiering ethics, and the raw-API passthroughs give a credible path to
depth. The gap is a missing **live gatherer** that pulls social-native dimensions
(frequency/placement/creative/attribution series) from the adapters into engines that already know
what to do with them. I would pilot specifically to watch that wiring land and to pressure-test the
engines on real data — not adopt it as a primary buying tool today.

---

### Notes on verification
- All code citations are from the working tree at review time; no external/web research was
  required for these findings (no `UNVERIFIED_EXTERNAL_RESEARCH_REQUIRED` items).
- Platform API awareness in the adapters (Meta Graph v25, TikTok Business v1.3, Snap Marketing v1,
  Pinterest OpenAPI 5.28.0) is current per in-code comments
  (`meta/src/client.ts:940-942`, `snapchat/src/schemas.ts:3-4`, `pinterest/src/schemas.ts:3`);
  I did not independently date-verify vendor API versions.
