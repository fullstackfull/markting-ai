# Creative Review — Independent Assessment

**Reviewer role:** Creative strategist / paid-social creative buyer (independent)
**Runtime:** DEMO, synthetic fixtures. **Method:** every claim grounded in code paths cited below.
**Date:** 2026-10-04

---

## 1. What actually ships on the creative surface

Two pages exist:

- `platform/apps/cloud/app/dashboard/creative/page.tsx` — the "Creative Library".
- `platform/apps/cloud/app/dashboard/creative/[creativeId]/page.tsx` — creative detail.

### Data path (traced end to end)

- The library page calls `loadSection(tenant, 'CREATIVE_REVIEW')` (`lib/cloud/intelligence.ts:57`), which runs `AssistantIntelligenceService` over `demoGatherer` (DEMO) or `emptyGatherer` (live). `CREATIVE_REVIEW` dispatches to **`buildCreative(acc)`** in `lib/markting/orchestrator/sections.ts:143` (`sectionForIntent`, line 399).
- The detail page calls `loadCreativeDetail` (`lib/cloud/intelligence.ts:79`) → **`buildCreativeDetail(acc, id)`** (`sections.ts:173`).
- Live mode returns `{ found:false, multimodal:'MULTIMODAL_NOT_CONFIGURED', 'No live provider connected.' }` (`intelligence.ts:82`) — nothing is shown until a provider is wired.

### What the library table renders

`components/intel.tsx:43-44` renders a 6-column table: **Creative | Hook | CTR | State | Fatigue | Spend %**, each row linking to the detail page. No thumbnails, no preview, no filters, no winners/losers grouping, no sort, no hook/angle/format rollup.

### The fixture universe is tiny

`lib/markting/orchestrator/seed.ts` contains **5 creatives total** (4 in the Ramadan account, 1 in Electronics, 0 in the third client). `SeedCreative` (seed.ts:32-48) carries `hook`, `angle`, `format`, aggregate `impressions/clicks/conversions/spendMinor`, and two daily series: `ctrSeries`, `frequencySeries`. **There is no ad-copy field and no asset reference/URL.**

### What the detail page shows

`[creativeId]/page.tsx` + `buildCreativeDetail`: a `MULTIMODAL_NOT_CONFIGURED` banner (line 28), performance chips (spend/impr/clicks/conv/CTR/CPC/CPA — note `roas` is hard-coded `0`, sections.ts:188), lifecycle/state/cluster (`cluster: "cluster:" + hook`, a trivial string), fatigue evidence, one templated test idea, and a link to the campaign.

---

## 2. Is the "intelligence" real or scaffolding?

### 2a. The SHIPPED fatigue read is thin statistical scaffolding

Shipped fatigue (`buildCreative` sections.ts:148-149 and `buildCreativeDetail` sections.ts:177-178) is:

```
fatigue = CTR trend down (not NOISE) AND frequency trend up  → FATIGUE_SIGNAL
          CTR down AND frequency up                          → WATCH
          else                                               → NO_SIGNAL
```

`classifyTrend` (`lib/markting/intelligence/trend.ts`) is a **genuine** deterministic engine (median + MAD baseline, directional consistency, structural-shift test, 7-point minimum) — that part is real and defensible. But as wired into the creative surface it is only a 2-metric heuristic: **no CPM gate, no CVR/ROAS/CPC corroboration, no confidence, no sample-size gate.** `lifecycle` is age-only (`firstSeenDaysAgo`, sections.ts:182). `state` (`STRONG` at ≥300 conversions, sections.ts:154) is an absolute hard-coded cutoff, not cohort-relative.

### 2b. A far better creative engine EXISTS — and is DEAD CODE

`lib/markting/creative/` is a large, well-designed, honest engine:

- **`fatigue.ts`** — multi-signal fatigue (`assessFatigue`): frequency pressure, falling CTR, rising CPC, declining CVR/ROAS, **CPM "not falling" as a HARD GATE** so an auction-wide cheap-impression effect is never mislabeled creative fatigue (lines 73-85), confidence levels, `INSUFFICIENT_EVIDENCE` on thin data, and `STRONG_FATIGUE_SIGNAL` never = "proven".
- **`performance.ts`** — `rateCreative` (cohort-relative; **low spend / thin conversions is NEVER a "loser"**, lines 64-67), `creativeLifecycle` (evidence-based, not age), `creativeComparability` (currency/objective hard blockers), and `creativeContribution` with a **CPM-attribution guard** ("never blame the creative when CPM moved the number", lines 150-170).
- **`surfaces.ts`** — `buildCreativeLibrary` (topPerformers / watch / fatigueSignals / underperformers / new, grouped byHook/byAngle/byFormat/byCluster), `buildCreativeDashboard` (every count carries conversion sample size + an explicit non-comparability caveat), `answerCreativeQuestion` (intent-classified creative Q&A: which-tiring / best-hooks / carrying-campaign / what-to-test / video-vs-image), `creativeBriefItems` (materiality-prioritized).
- **`classify.ts`** — bilingual (en/ar) deterministic hook/angle/feature taxonomy classification over copy, with evidence spans; `OTHER/UNKNOWN/MULTIPLE` first-class.
- **`clustering.ts`** — explainable feature-key clustering (no opaque embeddings), mixed-currency safe.
- **`dedup.ts`** — variant vs duplicate relation; never merges distinct media on text similarity alone.
- **`recommendations.ts`** — typed review recommendations + structured test ideas labelled `HYPOTHESIS`, direction-only (never a fabricated lift number).
- **`visual.ts` / `multimodal-gateway.ts`** — a structured visual/video feature schema and a governed multimodal gateway (model-role allowlist, size/duration caps, per-org cost accounting, content-hash cache, explicit refusal to infer protected characteristics or identity).
- **`store.ts`** — tenant-scoped, insert-only versioned analysis persistence; derived creative memory gated on sufficient sample.

**Wiring verdict (grounded):** a code-wide search shows every one of these modules is imported **only by `test/phase4-*.test.ts`**. The sole production import is the **type** `CreativeRecommendation` (into `orchestrator/recommendation.ts`, `orchestrator.ts`, `demo-gatherer.ts`). `assessFatigue`, `MultimodalGateway`, `buildVisualAnalysis`, `buildCreativeLibrary`, `rateCreative`, `generateCreativeRecommendations`, `classifyCreativeText` — **none are reachable from any page, surface, or the orchestrator.** There is also a *third*, older parallel creative analyzer (`intelligence/creative.ts` `analyzeCreatives`, Phase 2L) that is likewise only called by tests. Three creative implementations exist; the one that ships is the weakest.

### 2c. The served creative recommendation is a hard-coded string

The creative-fatigue recommendation that reaches the workspace/diagnosis is authored by hand in `demo-gatherer.ts:55` with hard-coded `evidence.signals = ['ctr_decline','frequency_rise']` and reasoning text — it is **not produced by `assessFatigue` or `generateCreativeRecommendations`.** It is seeded content, converted via `fromCreativeRecommendation`.

### 2d. Multimodal understanding: genuinely absent, and genuinely honest

There is **no visual/video understanding anywhere in the live path.** The detail page states `MULTIMODAL_NOT_CONFIGURED` (page.tsx:28, sections.ts:171/189/191); even the gateway's fallback returns `metadataOnly:true` with every feature `UNKNOWN` and explicitly refuses to guess from copy/filename (`visual.ts:47-49`). Hooks/angles on the surface are hand-authored seed labels (`'Lanterns' / 'Tradition'`), not classified from copy (the seed has no copy to classify). **This is the honest-flag the brief asked me to verify: it is present, accurate, and not faked.** Credit for integrity; but as a capability it is zero.

---

## 3. Scores (0–5) — scoring the SHIPPED product

| Dimension | Score | Basis |
|---|---|---|
| Creative library | 1.5 | 5-row link table; no filters/grouping/thumbnails. Full library engine exists but unwired (`surfaces.ts`). |
| Creative performance | 2.0 | Real CTR/CPC/CPA/spend math; `roas` hard-coded 0; absolute (non-cohort) state cutoffs. |
| Fatigue | 2.0 | Real `classifyTrend` backbone, but only 2 signals, no CPM gate/confidence on the surface. Superb `fatigue.ts` sits unused. |
| Hooks | 1.5 | Hand-labeled strings; hook→conversion aggregation computed (`buildCreative`) but not surfaced in detail. |
| Angles | 1.0 | A label only; no angle analysis rendered. `classify.ts` taxonomy unwired. |
| Lifecycle | 2.0 | Age-only NEW/MATURE/DECLINING on surface; evidence-based `creativeLifecycle` unwired. |
| Placement performance | 1.0 | `buildBreakdown` (placement/device/geo) exists under a different intent; **not** on the creative surface and not creative-level. |
| Winners / losers | 2.0 | `state` STRONG/UNDERPERFORMING per row, but no ranked winners/losers view; cohort-gated rating unwired. |
| Creative testing ideas | 2.0 | One templated test-idea string on detail; structured `creativeTestIdea`/experiments logic unwired. |
| Recommendation evidence | 1.5 | Served reco is a hard-coded seed string with canned evidence; evidence model is honest but not computed. |
| Multimodal understanding | 0.5 | None live; honestly flagged (`MULTIMODAL_NOT_CONFIGURED`). Points only for integrity. |
| Variant comparison | 0.5 | Nothing shipped; `dedup.ts` variant engine unwired. |

**Weighted overall: ~1.5 / 5 as a shipped creative tool.** (The *latent* engine, if wired + given a model, would plausibly be 3.5–4.)

---

## 4. Strengths

1. **Intellectual honesty about multimodal.** `MULTIMODAL_NOT_CONFIGURED` / `metadataOnly` is pervasive and truthful; no fabricated visual claims. Rare and commendable.
2. **A genuinely strong, well-reasoned creative engine exists** (`fatigue.ts`, `performance.ts`, `surfaces.ts`) — CPM-gated fatigue, cohort-relative rating, low-spend-never-a-loser, comparability hard-gates, CPM-vs-creative attribution. This is domain-expert-grade thinking.
3. **Real deterministic statistics** underpin the shipped fatigue read (`trend.ts` median+MAD, consistency, structural-shift).
4. **Safety/ethics by construction** — `FORBIDDEN_VISUAL_INFERENCES`, `facePresent` boolean-only, ad copy treated as data-not-instructions, review-only recommendations that cannot publish/modify a creative.
5. **Currency/sample discipline** — spend share null on mixed currency, sample sizes attached to counts, explicit non-comparability caveats.

## 5. Gaps

1. **The best creative code is dead code.** The Phase-4 engine is reachable only from tests; the surface runs a thin parallel path. This is the single biggest finding.
2. **No visual/video understanding at all** — for a creative buyer whose job is judging the asset, a tool that never shows or analyzes the asset is a non-starter.
3. **No asset rendering** — no thumbnails, no video, no preview; you cannot even *see* the ad. Native Ads Manager wins trivially here.
4. **Tiny, synthetic universe** (5 creatives) with hand-labeled hooks/angles; `classify.ts` can't run (no copy in seed).
5. **Served recommendation is hard-coded**, not engine-computed; `roas` hard-coded 0; placement is not surfaced at creative level; no ranked winners/losers or variant-comparison view.

---

## 6. Verdict

**WOULD_NOT_USE** (as a paid-social creative tool, as shipped).

A creative buyer's core loop is *look at the asset → judge hook/visual/pacing → compare variants → act*. This product renders no asset, has no multimodal understanding (honestly so), surfaces five synthetic rows, and runs a 2-signal fatigue heuristic while a far better CPM-gated engine sits unwired. It is **materially worse** than reviewing ads natively (where you see thumbnails, video, and placement breakdowns) plus a spreadsheet. The honesty and the latent engine are real assets: **wire `creative/*` into the surface and attach a multimodal model and this plausibly becomes WOULD_PILOT** — but I score what ships, and what ships is a scaffold.
