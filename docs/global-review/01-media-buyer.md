# Independent Review — Senior Performance Media Buyer

**Reviewer role:** 10+ yrs buying on Meta/Google/TikTok/Snap, meaningful budgets.
**Question:** Would I replace significant parts of my daily workflow with MARKTING-AI?
**Method:** Read the actual dashboard code and the engines behind it (DEMO runtime, synthetic fixtures, no live credentials). Every claim below cites a file I opened. I did not run the app; I traced the reachable code paths.

---

## What I actually looked at

- Workspace ("Needs attention"): `platform/apps/cloud/app/dashboard/workspace/page.tsx`
- Accounts list + drill-down: `app/dashboard/accounts/page.tsx`, `app/dashboard/accounts/[accountId]/page.tsx`, `.../campaigns/[campaignId]/page.tsx`
- Recommendations: `app/dashboard/recommendations/page.tsx`
- Experiments: `app/dashboard/experiments/page.tsx`
- Creative library + detail: `app/dashboard/creative/page.tsx`, `app/dashboard/creative/[creativeId]/page.tsx`
- Overview landing + nav: `app/dashboard/page.tsx`, `components/nav.tsx`
- Rendering layer: `components/intel.tsx` (SectionView), `components/charts.tsx`
- Data/engine layer: `lib/cloud/intelligence.ts`, `lib/markting/orchestrator/{orchestrator,sections,demo-gatherer,seed,assistant-service,money}.ts`
- Engines: `lib/markting/intelligence/{anomaly,forecast,scaling,pacing}.ts`

---

## The core architecture (and why it matters to me)

There is a real deterministic composition engine, not a pile of canned strings. `MarketingIntelligenceOrchestrator.compose()` (`orchestrator.ts:159`) ranks cross-domain "contributing factors" by a pure `scoreFactor` (severity×100 + materiality + confidence; line 57), picks a single `nextAction`, and unifies recommendations. The drill-down "sections" (`sections.ts`) genuinely run statistics engines over the seed: a robust modified-z-score anomaly detector with trailing baseline and alert-storm suppression (`anomaly.ts:80`), a run-rate forecast that ships an uncertainty band and explicit limitations (`forecast.ts:36`), straight-line pacing with an early-period projection guard (`pacing.ts`), and a scaling-readiness gate that refuses to call a campaign scale-ready on volume alone without a beaten target (`scaling.ts:48`).

This is the right skeleton, and it is unusually disciplined about honesty: trust tiers, "UNKNOWN (COGS missing)", "MULTIMODAL_NOT_CONFIGURED", protected-dimension handling, refusal to blend currencies (`money.ts:53`). As a buyer who has been burned by tools that silently zero-fill or invent attribution, I respect this. But discipline about *what it won't claim* is not the same as *doing my job faster*, and that is where it falls short today.

**The decisive caveat:** the top-level workspace/recommendations narrative is NOT computed from the seed. `demoGatherer.gather()` (`demo-gatherer.ts:35`) returns **hard-coded** media/commerce/creative diagnoses and **hard-coded materiality shares** (`{refunds 0.6, revenue-up-profit-down 0.3, cpa 0.1}`, line 67). So the headline "why profitability declined" and its attribution percentages are an authored scenario, while only the *section* drill-downs (pacing/anomaly/forecast/creative/breakdown) are real computations over `seed.ts`. The two are not even wired to the same account id — `gather()` defaults to `sandbox:acc:1` (line 37) which does not exist in `SEED_PORTFOLIO` (whose primary is `sandbox:acc:ramadan`, `seed.ts:154`). A reviewer clicking "inspect evidence" on the flagship diagnosis gets an asserted number, not a derived one.

---

## Walking my real daily workflow through it

**1. "What happened yesterday / today?" — I can't ask this.**
There is no date-range control anywhere. `grep` for date pickers across `app/dashboard/` returns nothing; the drill-down pages accept no date `searchParams`. The window is frozen in the fixture: `WINDOW = 2026-09-16..2026-10-03` (`sections.ts:35`), 28-day series, `periodDaysElapsed: 18/30` (`seed.ts:155`). I cannot look at yesterday, last 7 days, MTD, or a custom range. For a daily driver this is disqualifying on its own — my morning is "what changed since yesterday," and the product has no concept of "yesterday."

**2. "Understand performance at a glance" — the landing page is governance, not performance.**
`/dashboard` (`page.tsx`) shows connection statuses, count awaiting approval, and audit-event count. No spend, no CPA, no ROAS, no trend. The actual performance view is `/dashboard/workspace`, one of **15 primary nav items** plus 6 utility items (`nav.tsx:48-75`). The IA is built for a governance/agency persona, not a buyer who wants numbers first.

**3. Numbers are shown as raw minor units.** This is the single most jarring thing. The campaign KPI chips render `CPA: {section.kpis.cpaMinor}` etc. as bare integers (`intel.tsx` campaign case; `sections.ts:298`). So I see "CPA: 3684", "CPM: 727", "Spend: 2250000" — halalas, no currency symbol, no decimal. A `formatMoney` helper exists (`components/ui.tsx:67`) and a canonical Money adapter exists (`money.ts:59`), but the module's own docstring admits integration is "PARTIAL" and the buyer-facing intel surfaces don't use it. I should never have to mentally divide by 100 and guess the currency.

**4. "Why did CPA/ROAS/profit change?" — a good answer, but a fixed one.**
The composed diagnosis (`workspace/page.tsx`) reads well: ranked factors, a plain-language headline that names commerce vs media vs creative contribution (`orchestrator.ts:109`), a next action, a "next best question." This is genuinely the shape of a good diagnosis. But it is the same authored scenario every time (refunds → profit, one fatiguing creative, one CPA deterioration), the materiality split is hard-coded, and there is no way to interrogate it ("why do you say refunds are 60% of it?"). As a diagnostic *pattern* it's strong; as a *tool that diagnoses my actual account today*, it is not demonstrated.

**5. "Find wasted spend" — partial and indirect.** There's no "wasted spend" view. The closest is creative underperformers/concentration (`sections.ts:143`), breakdown efficiency spread/HHI (`buildBreakdown`), and downscale candidacy (`scaling.ts:86`, not surfaced on any page I found). No "ads/placements/geos spending with zero or far-above-target CPA, ranked by $ wasted." I'd have to assemble it myself.

**6. "Find scaling opportunities" — effectively dead in the demo.** `buildScaling` passes `windowComplete: false` (`sections.ts:108`), and `evaluateScalingReadiness` returns `NOT_EVALUABLE` whenever the window is open (`scaling.ts:37`). So the scaling section permanently reads "0 of N campaigns scaling-ready." It's *honest* (the period isn't over), but the headline scaling capability never produces a positive in the state a reviewer will see.

**7. "Inspect campaign/adset/ad/creative problems" — there is no ad-set/ad-group tier.** The hierarchy is account → campaign → creative only (`seed.ts`: campaigns[] and creatives[], no adsets). On Meta/Google I live at ad-set/ad-group level (budgets, audiences, bids are set there). Their absence is a structural gap, not a demo shortcut.

**8. "Detect fatigue" — this is the best-executed buyer feature.** Fatigue is derived from a real signal: CTR trend down + frequency trend up (`sections.ts:148`, `buildCreativeDetail:177`), with inspectable evidence strings and a test idea. Creative detail honestly says visual analysis is `MULTIMODAL_NOT_CONFIGURED` rather than faking it (`creative/[creativeId]/page.tsx:28`). I trust this one.

**9. "Compare channels" — present and careful.** `buildCrossChannel` compares Meta vs Google and refuses to rank when conversion definitions/attribution differ (`sections.ts:338`, "NOT_COMPARABLE"). Correct and rare. But it's two synthetic channels on one account; no TikTok/Snap, no blended portfolio roll-up with currency separation beyond the agency view.

**10. "Understand pacing" — solid.** The pacing gauge (elapsed vs spent) plus delivery-vs-opportunity interpretation (`pacing.ts`) is exactly how I think about it, and it withholds a projection early in the period instead of extrapolating noise. Good.

**11. "Decide fast / act" — governed, slow, and review-only.** Nothing in the Recommendation Center does anything: "accepting records intent for a future governed preview; it does not change anything" (`recommendations/page.tsx:54`). Every actual change must go through a separate preview → pending-approval → apply path, and per the README pending previews expire in 15 minutes. I understand the safety rationale (single write path, human approval) and I even like it for a team — but it means the tool is an advisor, not something I act inside of.

**12. "See evidence / avoid false alarms" — strong on both.** Evidence is inspectable (`recommendations/page.tsx:51` dumps `evidenceDetail`; every section shows its working). False-alarm discipline is real: anomaly requires statistical extremeness AND material %/absolute change AND caps alert storms (`anomaly.ts:121-135`); scaling demands a beaten target. This is the product's strongest suit.

**13. "Prioritize" — yes, deterministically.** Factors ranked by `scoreFactor`; agency portfolio ranked by an attention score with reasons (`sections.ts:265`). The ranking is transparent and testable.

---

## Scores (0–5) by the dimensions I was asked to judge

| Dimension | Score | Evidence |
|---|---|---|
| Understand yesterday/today performance immediately | **1** | No date control; window frozen in `sections.ts:35`/`seed.ts:155`; landing page is governance not performance (`app/dashboard/page.tsx`). |
| Diagnose why CPA/ROAS/profit changed | **3** | Strong composed pattern (`orchestrator.ts:109`) but headline + materiality are hard-coded (`demo-gatherer.ts:67`), not derived; not interrogable. |
| Find wasted spend | **2** | Only indirect (creative underperformers, breakdown spread, downscale not surfaced); no ranked $-wasted view. |
| Find scaling opportunities | **1.5** | `windowComplete:false` forces `NOT_EVALUABLE` (`sections.ts:108`→`scaling.ts:37`); never shows a positive. |
| Inspect campaign/ad-set/ad/creative problems | **2** | No ad-set/ad-group tier at all (`seed.ts`); campaign + creative only. |
| Detect fatigue | **4** | Real CTR↓/freq↑ logic + evidence + honest "no multimodal" (`sections.ts:148`, `creative/[creativeId]/page.tsx:28`). |
| Compare channels | **3** | Careful comparability gating (`sections.ts:338`); only 2 synthetic channels, Meta/Google. |
| Understand pacing | **4** | Delivery-vs-opportunity + early-period guard (`pacing.ts`). |
| Decide fast / act | **2** | Review-only; separate preview→approval; 15-min preview expiry (`recommendations/page.tsx:54`, README). |
| See evidence behind recommendations | **4.5** | `evidenceDetail` exposed; every section shows its working (`recommendations/page.tsx:51`). |
| Prioritize | **4** | Deterministic factor/portfolio ranking (`orchestrator.ts:57`, `sections.ts:265`). |
| Avoid false alarms | **4.5** | Multi-gate anomaly + alert-storm cap + scaling target gate (`anomaly.ts:121`, `scaling.ts:48`). |
| Ask free-text questions | **2.5** | Deterministic regex intent router, no LLM in demo (`assistant-service.ts:36-68`); fixed sections/windows; can't do arbitrary slices. |

**Unweighted mean ≈ 3.0.** Weighted toward what fills my day (today's numbers, acting, finding waste/scale), it's lower — call it a **2.6**.

---

## Top 10 strengths

1. Honest data posture everywhere — synthetic/UNVERIFIED/UNKNOWN surfaced, never faked (`intelligence.ts:19` source guard; `sections.ts:246` COGS withheld).
2. Real statistics, not canned text: anomaly (`anomaly.ts`), forecast with bands + limitations (`forecast.ts`), pacing, scaling.
3. Excellent false-alarm discipline (multi-gate anomaly + storm suppression).
4. Fatigue detection grounded in CTR/frequency with inspectable evidence.
5. Cross-domain composition that connects ads ↔ commerce ↔ creative into one ranked diagnosis (`orchestrator.ts`).
6. Evidence is always one click away; nothing asks for blind trust.
7. Transparent, testable prioritization (pure scoring functions).
8. Channel comparison refuses to compare the incomparable (`cross-channel`).
9. Currency integrity — no invented FX, no blended fake totals (`money.ts:53`, `sections.ts:281`).
10. Scaling gate won't greenlight on volume without a beaten target — matches how a disciplined buyer actually scales.

## Top 10 gaps

1. **No date range / "yesterday" / MTD** — the product has no time selector at all.
2. **Numbers rendered as raw minor units** with no currency symbol/decimals in buyer-facing KPIs (`intel.tsx` campaign/creative cases).
3. **No ad-set/ad-group level** — a structural miss for Meta/Google buyers.
4. **Flagship diagnosis + materiality are hard-coded**, not computed, and point at a non-existent account id (`demo-gatherer.ts:37,67`).
5. **Scaling section permanently `NOT_EVALUABLE`** in the demo (`windowComplete:false`).
6. **No ranked "wasted spend" view**; downscale engine exists but isn't surfaced.
7. **Actions are review-only**; acting requires a separate governed flow with a 15-min preview expiry.
8. **No daily trend line** for CPA/ROAS/spend — a `TimeSeriesChart` exists (`charts.tsx:41`) but the campaign page only draws a pacing gauge + current-vs-previous bars.
9. **Free-text Q&A is a regex router**, not an LLM, in demo — brittle to how buyers actually phrase questions; can't do custom slices/windows.
10. **Tiny data surface** (3 accounts, ≤3 campaigns, 4 creatives, 2 channels) and a 15-item primary nav tuned for governance/agency, not a buyer's cockpit.

---

## What would block daily adoption

A single thing blocks it before anything else: **I cannot choose a time period.** My entire day is comparisons across dates. Add to that raw-minor-unit money, no ad-set tier, no "yesterday," and the fact that I can't act inside the tool, and it cannot be my daily driver as built. These are not nitpicks; each one is load-bearing for a buyer.

## What would make me switch

- Date range + comparison (yesterday, 7/14/28d, MTD, custom, vs prior period) wired through every surface.
- Properly formatted money/percent with currency, and daily trend charts for CPA/ROAS/spend/CTR.
- Full hierarchy incl. ad-set/ad-group, with per-entity diagnosis.
- A real "wasted spend, ranked by $" view and a scaling view that produces candidates mid-flight.
- The composed diagnosis computed from *my* data with interrogable attribution (and ideally an LLM narrator, which the code is clearly architected to drop in — `assistant-service.ts` narrator slot).
- A tighter, faster act loop (in-context approve, longer preview TTL).

---

## Final verdict

The engineering judgment here is genuinely above average — the honesty, the real statistics, the evidence trail, the refusal to fabricate are things most commercial tools get wrong. But as a **working buyer's cockpit today it is a demonstration of a philosophy, not a daily instrument**: no time control, money shown as raw halalas, no ad-set tier, a hard-coded flagship diagnosis, and review-only actions. I would not run my budgets on this as-is, but the bones are good enough that I'd want to pilot it and watch the roadmap.

**Verdict: WOULD_PILOT.**
