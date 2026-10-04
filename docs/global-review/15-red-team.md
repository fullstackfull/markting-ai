# 15 — Red Team: The Case AGAINST a Media Buyer Adopting MARKTING-AI

**Reviewer role:** Independent skeptical media-buyer red team. Mandate: find reasons NOT to buy.
**Method:** Traced realistic buyer tasks (connect accounts → read campaigns → "Ask AI" → get recommendations → change a budget) through the actual routes and `lib/markting/**`. Every claim below cites code I opened.
**Date:** 2026-10-04 · App under review: `platform/apps/cloud`

---

## Executive verdict (up front)

MARKTING-AI is a **genuinely rigorous deterministic analytics engine wired to a synthetic demo, bolted onto a thin live cross-platform report, wearing an "AI" costume.** The engineering quality of the *diagnostic math* is high and the *honesty labelling* is unusually disciplined. But for a working media buyer evaluating it **today**, the product does not do the job its name promises:

- The "intelligence" (CPA decomposition, scaling readiness, forecasting, saturation, budget reallocation, cross-channel, creative fatigue, commerce profit) runs **only on hardcoded synthetic seed data**, never on the buyer's real accounts.
- The buyer's **live** account data (the 11 real ad adapters) flows to exactly one place: a flat read-only table of spend/impressions/clicks/conversions/ROAS — i.e. a worse version of what Meta/Google Ads Manager already give them.
- There is **no "AI"**: no model is wired (gateway DORMANT); "Ask Markting AI" is a regex intent-router that restates deterministic findings.
- Out of the box the tool **cannot change anything** on a provider (writes default-disabled).

It is honest about all of this in the code and in per-surface labels. That honesty saves it from being a *scam*; it does not make it a *tool a media buyer would use*.

---

## The central structural problem: the intelligence is disconnected from live data

This is the finding that sinks adoption. There are **two completely separate data surfaces** and the impressive one never sees real data.

### Surface A — the "intelligence" / "Ask AI" / Recommendations / Workspace
All of these route through `lib/cloud/intelligence.ts → AssistantIntelligenceService`. The data source is chosen here:

```
// lib/cloud/intelligence.ts:45-47
function serviceForMode(): AssistantIntelligenceService {
  return new AssistantIntelligenceService(isDemoMode() ? demoGatherer : emptyGatherer);
}
```

There are only **two** `IntelligenceGatherer` implementations in the entire codebase (confirmed: `grep IntelligenceGatherer` → only `assistant-service.ts` and `demo-gatherer.ts`):

- `demoGatherer` — a **hardcoded synthetic scenario** ("Ramadan Awareness - KSA", 22% refund rate, a fatiguing creative cluster), every tier `SYNTHETIC` (`lib/markting/orchestrator/demo-gatherer.ts:31-71`).
- `emptyGatherer` — returns `MEDIA: 'NOT_CONNECTED', COMMERCE: 'NOT_CONNECTED', CREATIVE: 'NOT_CONNECTED'` and **no signal at all** (`demo-gatherer.ts:20-29`).

There is **no live gatherer**. A real deployment is `isDemoMode() === false` → `emptyGatherer` → every intelligence surface is permanently empty, *even when the buyer has connected Meta and Google and data is visibly flowing to the Reports table.* The Workspace page literally tells a connected buyer "Connect providers and a store for a full picture" (`app/dashboard/workspace/page.tsx:72`).

The rich analytical sections confirm this. `lib/markting/orchestrator/sections.ts` — the file that runs the real engines (pacing, anomaly, forecast, scaling, response-curve/saturation, allocation, MER, margin, cross-channel) — takes `SeedAccount` as its input type for every builder (`buildPacing(acc: SeedAccount)`, `buildForecast(acc: SeedAccount)`, `buildScaling(acc: SeedAccount)`, …, lines 39-217). Its own header is candid:

> "analytical 'answer sections' computed by the REAL deterministic engines **over the seed**. The seed figures are synthetic; they are passed to the engines **as if platform-reported**." (`sections.ts:2-7`)

And the `emptyGatherer` has **no `sections` method at all**, so a live deployment gets *zero* analytical sections.

### Surface B — the live provider read (Reports / Accounts)
`lib/cloud/reads.ts` is the only true live path. `readReport()` calls `runtime.registry.call('report', …)` across connected providers (`reads.ts:48-62`) using the real `@adport/provider-*` packages (`lib/cloud/runtime.ts:4-12`, all 11 imported). This produces `ReportRow[]` rendered as a plain table on `app/dashboard/reports/page.tsx` (spend/impressions/clicks/conversions/ROAS).

### The gap
**Nothing converts `ReportRow` → `MetricObservation`** (the input type the diagnostic engine consumes). I grepped for it: the only producers of `MetricObservation` are `scale-fixtures.ts` (test fixtures) and the demo seed. `analyzeAccount` (the 200-line crown-jewel orchestrator in `intelligence/analyze.ts`) is imported by exactly one caller, `intelligence/service.ts`, which is itself only reachable via the demo/seed path.

So the buyer's real Meta/Google numbers are shown in a dumb table and **never diagnosed, never scored, never turned into a recommendation.** The entire value proposition — "AI that tells you what to do with your campaigns" — operates on fiction.

---

## Reason-not-to-buy catalogue (each with evidence)

### 1. There is no AI. (Honesty label: present, but the product *name* overclaims)
`lib/connections/registry.ts:137` — the AI gateway provider: `liveTransportImplemented: false`, notes: **"DORMANT governance seam; deterministic local narrator only. No live model wired (BLOCKED_EXTERNAL)."** The gateway's demo config routes every role to `provider: 'scripted', model: 'scripted-demo'` (`ai-gateway.ts:118-128`), and `service.ts:50-55` always returns `localFallback: true` with a comment "No live model transport in Phase 2."

"Ask Markting AI" (`intelligence/ask.ts`) is **8 regex patterns** (`PATTERNS`, lines 18-27); anything unmatched falls to `GENERAL_BRIEF`. The orchestrator router (`assistant-service.ts` `RULES`) is a longer 23-rule regex table. Answers are assembled by `ds.map((d) => `• ${d.summary[locale]}`).join('\n')` (`ask.ts:43`) — i.e. it **restates the deterministic diagnosis summaries verbatim**. A buyer asking "why did my CPA jump and what should I do?" in any phrasing the regex misses gets a canned morning brief. Ask "compare Meta vs Google" and you always get the stock sentence "A channel comparison needs multi-provider data…" (`ask.ts:70-72`) — a dead end.

**Verdict:** honestly labelled internally as deterministic, but the brand ("MARKTING-**AI**", "Ask Markting AI", "intelligence") sells something the code explicitly does not contain.

### 2. The flagship analysis only ever runs on a fake account.
Covered above. The demo scenario is a single fixed story. Evidence: `demo-gatherer.ts:40-71` (one `CPA_DETERIORATION`, fixed refund rate), `sections.ts` builders all typed to `SeedAccount`, `SEED_PORTFOLIO` import. **A buyer cannot get the saturation curve, budget-reallocation scenario, forecast, or scaling verdict for their own campaign — only for "Ramadan Awareness - KSA".**

### 3. Recommendations are not prescriptions — they are "go look at this" labels.
Every recommendation action type is a **REVIEW_**: `REVIEW_DELIVERY`, `REVIEW_FUNNEL`, `REVIEW_CREATIVE_REFRESH`, `REVIEW_BUDGET_REDUCE`, `REVIEW_BUDGET_SCALE`, `REVIEW_PAUSE` (`recommendation.ts:54-72`). There is **no magnitude** anywhere — no "increase budget 20%", no target CPM, no reallocation amount in the rec itself. The scaling engine deliberately "never produces an automatic percentage" (`scaling.ts:1-6`). Accepting a rec "does not mutate anything — it only moves it to ACCEPTED_FOR_PREVIEW" (`recommendation.ts:6`). The Recommendation Center page confirms "Every item is review-only" (`app/dashboard/recommendations/page.tsx:22`). A senior buyer already knows "CPA is up, go check the funnel." Being told to *review* something, with no recommended action size, is below the bar of a junior analyst.

### 4. Out of the box it cannot touch a campaign.
`runtime-mode.ts:37` — a non-demo deployment defaults to `LIVE_WRITE_DISABLED`. `canApply` is true only for `DEMO` and `LIVE_WRITE_APPROVAL_ONLY` (`runtime-mode.ts:41`); applying throws `"Applying changes is disabled … gated behind the Phase 0 exit"` (`:58-64`). So the realistic adopted state is: read-only table + preview-only + synthetic recommendations. The buyer still does 100% of the actual work in the native platforms.

### 5. Commerce / profit intelligence is entirely dormant.
The whole "true profit vs platform ROAS" pitch (MER, margin, break-even, refund reconciliation — `commerce/*`, and the demo's headline `REVENUE_UP_PROFIT_DOWN`) depends on commerce connectors that are **all** `liveTransportImplemented: false`, `connect: false`, `testConnection: false` with "Live transport + credentials are BLOCKED_EXTERNAL; no ingress route or background runner is wired in-repo" (`registry.ts:101-132`). So the single most differentiated feature (profit, not vanity ROAS) is demo-only. `loadCampaign`/`loadCreativeDetail` return "No live provider connected" in non-demo mode (`intelligence.ts:62-90`).

### 6. No native-platform depth; it is a lowest-common-denominator layer.
The live report pulls exactly 5 metrics at campaign level (`reads.ts:54`: `spend, impressions, clicks, conversions, roas`). No ad-set/ad granularity in the report, no placement/device/audience breakdown from live data (the `audience`/breakdown engine runs only on seed, `sections.ts:23`), no native bid strategies, no learning-phase status, no auction/overlap insights, no pixel/CAPI diagnostics. Everything a media buyer lives in — Advantage+ / Performance Max internals, delivery insights, audience overlap — is absent. The product sits *above* the platforms and sees less than they do.

### 7. "Insights" that are restated metrics / trivial heuristics.
The anomaly→recommendation chain and the "diagnosis" prose are often just the metric movement reworded: `CPM rose X% — media auction cost pressure` (`diagnostics.ts:233-236`), `CTR fell X% — engagement … weakened` (`:225-228`). The pacing "diagnosis" is `actual spend fraction vs straight-line expected fraction` with a 10% drift threshold (`diagnostics.ts:142-152`) — a calculation any buyer does in their head. (To be fair, the CPA/ROAS **log-ratio factor decomposition** in `diagnostics.ts:182-218` is real, non-trivial, and well done — see "What saves it".) The forecast is explicitly "straight-line run-rate … no ML, no hidden model" (`forecast.ts:1-7`) — honest, but modest, and again only on seed data.

### 8. Disconnected surfaces create an actively misleading UX.
A connected buyer sees live campaigns in **Reports**, then opens **Workspace/Recommendations** and is told "Connect providers … for a full picture" (`workspace/page.tsx:72`) and "No recommendations" (`recommendations/page.tsx`), because those surfaces are fed by `emptyGatherer` while Reports is fed by `reads.ts`. Two surfaces, two contradictory truths about whether the account is connected. That erodes trust fast.

---

## Where the honesty labels genuinely save it (fair credit)

This team did not fake the intelligence — it *gated* it and *labelled* it, consistently:

- **No fabricated causes.** Thin/synthetic/stale/mixed-currency data yields `INSUFFICIENT_EVIDENCE`, not a made-up story (`diagnostics.ts:273-280`, `analyze.ts` evidence floors). The CPA/ROAS decomposition is arithmetic (log-ratio identity), explicitly "a decomposition, never a causal claim" (`diagnostics.ts:1-8`).
- **Scaling requires real winning evidence**, not volume: "never READY" without beating a *known* target (`scaling.ts:48-63`). Low spend is explicitly not treated as poor performance (`:90`).
- **Trust tiers travel everywhere** and a source-guard fails *closed* so synthetic data can't leak into a live surface (`intelligence.ts:19-23`). The Recommendations page banners "Demo / synthetic data — not live" when `!trust.live` (`recommendations/page.tsx:26`).
- **The registry is brutally honest** about what's live vs dormant, down to per-provider revoke semantics and "no background runner exists" caveats (`registry.ts` throughout).
- **Writes fail closed** by default (`runtime-mode.ts`). Every rec `requiresHumanApproval: true`.
- **Forecasts carry method + band + limitations** (`forecast.ts`), trend uses robust median/MAD and refuses to call one bad day a trend (`trend.ts`).

So this is **honest-but-dormant**, not deceptive. The gap between promise and delivery lives almost entirely in the product **name and marketing framing**, not in dishonest code. A buyer who reads the labels will not be *tricked* — they will simply conclude there is nothing to use yet.

---

## Dimension scores (0–5; 0 = unusable/absent, 5 = best-in-class for a media buyer)

| Dimension | Score | One-line justification |
|---|---:|---|
| Live data coverage / depth | **1** | 5 metrics, campaign-level, read-only table; intelligence never sees live data (`reads.ts`, no ReportRow→Observation bridge). |
| "AI" / reasoning substance | **1** | No model wired (DORMANT); regex router restating deterministic findings (`ask.ts`, `ai-gateway.ts:137`). |
| Diagnostic math quality (on the data it does have) | **4** | Real log-ratio factor decomposition, funnel localization, evidence gating (`diagnostics.ts`). |
| Recommendation actionability | **1** | All "REVIEW_*" labels, no magnitudes, accept = no-op (`recommendation.ts`). |
| Native-platform depth | **1** | LCD layer; sees less than Ads Manager; no ad-set/placement/learning-phase/auction detail. |
| Forecasting / optimization | **2** | Transparent run-rate + saturation/allocation, but seed-only and modest (`forecast.ts`, `sections.ts`). |
| Commerce / true-profit | **1** | Entire path BLOCKED_EXTERNAL / demo-only (`registry.ts:101-132`). |
| Trustworthiness of calculations | **4** | Currency-safe, evidence-floored, trust-tiered, source-guarded fail-closed. |
| Honesty / anti-overclaim (code & labels) | **4** | Dormant/synthetic/NOT_CONNECTED labelled everywhere; name is the only overclaim. |
| Workflow speed / surface coherence | **2** | Contradictory connected-state across Reports vs Workspace; read-only+preview only. |
| **Overall fitness for a real media buyer, today** | **1.5** | Impressive scaffolding; no live analytical pipeline; nothing to act on. |

---

## Genuine overclaims found (vs honest-dormant)

1. **The product name/positioning ("MARKTING-AI", "Ask Markting AI", "intelligence").** There is no AI model in the system (`registry.ts:137`); this is the one place marketing outruns the code. *Mitigated* by in-app "deterministic" / "local" labels, but the name itself is an overclaim.
2. **"ONE intelligence path, not a fixture-only alternate" (`analyze.ts:3-6`, `service.ts:9-16`).** Technically true that fixtures flow through the *same* code — but misleading by omission: in production there is **no non-fixture input** at all, because no live gatherer exists. The comment reads as reassurance that live data is handled; it is not.
3. **Implicit claim of connectedness on intelligence surfaces.** Not a code lie, but the UX overclaims: Workspace/Recommendations imply "connect for the full picture" as if connecting would populate them — connecting providers does **not** populate them (only `isDemoMode` does).

Everything else a skeptic would attack (commerce, writes, model, background sync, webhooks) is explicitly flagged dormant/BLOCKED_EXTERNAL and is therefore honest, not deceptive.

---

## Final verdict

**WOULD_NOT_USE.**

Not because it is dishonest or sloppy — the opposite: the diagnostic core and the honesty discipline are better than most products in this space. I would not use it because, for a media buyer's actual job **today**, it (a) never analyzes my real accounts, (b) contains no AI, (c) recommends only "go review this" with no action or magnitude, and (d) cannot change anything out of the box. The one live surface duplicates — less richly — what Meta and Google already show me. There is a strong engine here waiting for the two things that would make it a product: a live `ReportRow → MetricObservation` gatherer, and a wired model. Until those exist, this is an impressive demo and a governance skeleton, not a tool I would put between me and my campaigns.
