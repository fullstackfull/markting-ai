# Global Review 07 — CMO / Head of Growth

**Reviewer role:** Independent CMO / Head of Growth, product-maturity council.
**Scope:** Executive surfaces (`app/dashboard/executive`, `app/dashboard/workspace`, `app/dashboard/reports`), the intelligence/orchestration layer (`lib/markting/*`), and their trustworthiness.
**Method:** Every claim below is grounded in source. Paths are relative to `platform/apps/cloud/` unless noted. No feature is asserted that I did not read in code. Web research was not required for this evaluation; nothing here is marked UNVERIFIED_EXTERNAL_RESEARCH_REQUIRED because all findings are code-internal.

**Date:** 2026-10-04.

---

## 1. What the executive actually sees

### Executive Summary — `app/dashboard/executive/page.tsx`
Four server-rendered cards, composed in parallel:
- **Business performance** — a narrated brief for the `PROFITABILITY_DECLINE` intent (`loadWorkspaceIntelligence(tenant, 'PROFITABILITY_DECLINE')`, line 13).
- **Profit** — a `COMMERCE_PROFIT` section (refund rate, MER, contribution margin, reconciliation, AOV change).
- **Forecast** — a `FORECAST` section (spend/conversions/CPA estimate + band).
- **Data-quality warnings** — a `DATA_QUALITY` section.
- A single `IntelMeta` strip (line 22) shows the trust tier, answer source, and a "Demo / synthetic data" chip.

### Workspace / "Needs attention" — `app/dashboard/workspace/page.tsx`
A `DAILY_REVIEW` composition: one diagnosis headline + next-action chip, a **ranked contributing-factors list** (each with severity, confidence, data-trust, materiality %, priority), a recommendations table (domain / recommendation / risk / confidence), a "next best question," and a **domain-coverage strip** that labels each domain CONTRIBUTED vs NOT_CONNECTED/NO_SIGNAL.

### Reports — `app/dashboard/reports/page.tsx` + `engine-reports.tsx`
A genuine campaign table (spend, impressions, clicks, conversions, ROAS) read through the **provider registry** (`readReport` in `lib/cloud/reads.ts`, which gates on `hasConnectedProvider`), plus deterministic weekly/monthly engine report runs (HTML/PDF) with current-vs-previous windows and a `reconciled` flag.

---

## 2. Trust & evidence — the strongest part of this product

The intellectual honesty here is unusually disciplined, and it is enforced in code, not just prose:

- **One trust vocabulary, weakest-link capped.** `orchestrator/trust.ts` collapses four historical trust vocabularies into a single `DataTier` ladder (`SYNTHETIC < UNVERIFIED < PLATFORM_REPORTED < VALIDATED < RECONCILED`). `weakestTier` (line 25) and `summarizeTrust` (line 85) guarantee a composed answer is only as trustworthy as its weakest input, and set `live=false` the moment any synthetic source is present. This surfaces as the `TrustBadge`/"Demo" chip on every surface (`components/intel.tsx:84`).
- **Profit is withheld, never fabricated.** When COGS is unknown, margin resolves to `UNKNOWN (COGS missing)` end to end: `computeMargin` with `cogs: null` (`sections.ts:203`), the commerce summary (`sections.ts:208`), the `SectionView` commerce KV (`intel.tsx:47`), and a `MISSING_COGS` data-quality issue (`sections.ts:246`). The seed deliberately sets one client's `cogsMinor: null` to prove this (`seed.ts:56`, `seed.ts:237`).
- **No invented FX.** `money.ts:53` returns `undefined` for cross-currency comparison; the portfolio view explicitly refuses to blend currencies into "one fake total" (`sections.ts:281`).
- **The LLM never computes.** Composition is fully deterministic (`orchestrator/orchestrator.ts`); the model narrator "adds no facts" and "never invents figures" (`answer.ts:48`, `narrateDeterministic`). A failed model yields `LOCAL_FALLBACK` with the deterministic text, never a faked `LIVE_MODEL` (`answer.ts:106`). Default is `DETERMINISTIC_ONLY`.
- **Causality honesty.** Outcomes carry `causalStance` and `contamination`; the outcomes summary states "a rejected recommendation is not a failure; before/after is never called causal" (`sections.ts:220`).
- **Data problems are not performance problems.** `buildDataQuality` separates stale sync, attribution mismatch, provider schema drift, and missing required data from business signal, with explicit severities (`sections.ts:242-259`).
- **Fail-closed source isolation.** `lib/cloud/intelligence.ts:19` (`guardAnswerPosture`) re-verifies trust tier vs runtime posture before any answer reaches a surface, so a regression wiring demo data into a live deployment throws rather than leaks.
- **Capabilities are CI-enforced.** `orchestrator/capability-map.ts` ties each capability to a real route + section + named tests, and a 51-entry executable media-buyer benchmark (`orchestrator/benchmark.ts`) refuses to count a question as answerable unless a surface or routed assistant check actually passes.

**Verdict on trust:** Within its data, every number is traceable and every absence is labeled. I did not find a single fabricated or silently-inferred metric. This is the opposite of the usual dashboard that quietly fills gaps with zeros or made-up blends. For an executive, that discipline is the whole ballgame — I would trust what it *does* show.

---

## 3. The problem that overrides everything: it runs on synthetic data, and live mode shows nothing

This is the finding a CMO cannot get past.

- The orchestrator's only two data sources are selected in `lib/cloud/intelligence.ts:46`: `isDemoMode() ? demoGatherer : emptyGatherer`. There is **no third, live gatherer.** I searched (`grep` for any live/provider-reading gatherer) and found none.
- `demoGatherer` is hard-coded synthetic (`orchestrator/demo-gatherer.ts:31`): the entire "profitability declined because refunds are 22% of gross + a campaign CPA deteriorated + a fatiguing creative" story — including the numbers `netNow: 480000`, `refundRateByValue: 0.22`, materiality weights `0.6/0.3/0.1` — is a fixture. The richer seed (`orchestrator/seed.ts`) is explicitly "every figure is fabricated demo data."
- `emptyGatherer` (`demo-gatherer.ts:20`) returns every domain `NOT_CONNECTED` / `NO_SIGNAL` and contributes zero signal.

**Consequence:** In a real (live) deployment, the flagship **Executive Summary and Workspace surfaces render an honest-but-empty page** — "No material issues… connect providers," `INSUFFICIENT_EVIDENCE`. The cross-domain diagnosis that is the product's headline value ("why did profitability decline and what should I do") **only produces content on the synthetic seed.** The one surface that reads live data is Reports (via the provider registry), and that is a flat campaign table, not an executive narrative.

So the answer to "would you rely on it in weekly executive meetings?" is: **not on live accounts today**, because on live accounts the executive brief has nothing to say. The impressive engine work (pacing, anomaly, forecast, MER/margin, reconciliation, scaling, allocation) is real and tested — but it is wired to a fixture, not to my Meta/Google/TikTok spend. The gap between "the engines are real" and "the engines see my data" is unbridged in the reviewed code.

---

## 4. Does it answer the CMO's actual questions?

| CMO question | Answered? | Where / caveat |
| --- | --- | --- |
| Are we growing profitably? | Partially (demo only) | Commerce section: net revenue, MER, contribution margin, break-even ROAS — but margin UNKNOWN without COGS, and only on seed data. |
| What changed, and why? | Yes (demo only) | Workspace diagnosis + ranked contributing factors with materiality attribution (`orchestrator.ts` `mediaFactors/commerceFactors/creativeFactors`). This is genuinely good causal *structure*. |
| Where are we wasting money? | Indirectly | Saturation/marginal ROAS, scaling readiness, breakdown efficiency spread exist as sections — but they live on account surfaces, not the executive page, and run on the seed. |
| Where can we scale? | Indirectly | `SCALING` section + budget-scenario allocation with a conservation guarantee. Not on the executive page. |
| Which brands/channels need attention? | Yes (demo only) | `buildPortfolio` ranks clients by a deterministic attention score with reasons, no currency blending (`sections.ts:265`). Strong — but the **Executive page does not use it** (it is single-account; executive calls carry no `accountId`, so it defaults to the primary client). The portfolio view lives elsewhere. |
| Are we hitting targets? | Weakly | `intelligence/targets.ts` computes TARGET_BEAT/MISS/ON and returns UNKNOWN when no target is set (never invents a goal). Targets (ROAS 4.0, break-even 2.6) exist in memory — but there is **no targets-vs-actuals scoreboard on the executive surface.** |
| What risks are emerging? | Yes | Data-quality warnings + severity; attention next-action. Good. |
| What should my team do next? | Yes (demo only) | Single next action + ranked recommendations with risk/confidence + next-best-question. |

**Structural gap for an executive reader:** there is **no at-a-glance KPI scoreboard** (spend / revenue / ROAS / CPA vs target vs prior period) on the Executive page. It opens with prose, then ratios. A CMO skims numbers first; this surface makes you read a paragraph.

---

## 5. Display / traceability defects found

- **Monetary figures rendered in raw minor units, unlabeled.** The Forecast section prints `spend.estimate` directly (`sections.ts:69`, echoed in `intel.tsx:27` and `sections.ts:380`), and those values come from `dailySpendMinor` — i.e. halalas/cents. "Projected 12-day spend ≈ 1680000" is actually 16,800.00 SAR with no currency symbol. The commerce summary similarly prints bare `net` (`sections.ts:208`). `money.ts:59` (`formatMoney`) exists but is **not applied** to these narrative/section numbers. For an executive, an unlabeled 100×-scaled number is a real trust hazard despite all the upstream rigor. (The commerce `SectionView` KVs sidestep this by showing ratios/percentages instead of the raw total.)
- **Intent is hard-coded on the executive brief.** The Business-performance card always runs `PROFITABILITY_DECLINE` (`executive/page.tsx:13`). On the seed that matches the story; on a healthy account it would frame a decline narrative where none exists. Low risk given live mode is empty anyway, but it is a baked-in assumption.

---

## 6. Scores (0–5)

| Dimension | Score | Basis |
| --- | --- | --- |
| Trust & evidence traceability | **5** | Weakest-link trust tiers, withheld-not-fabricated profit, no FX blending, deterministic compute, fail-closed source guard, CI-enforced capability map. Best-in-class honesty. |
| Analytical depth / causal structure | **4** | Real engines (pacing, anomaly, forecast with bands+limitations, MER/margin/reconciliation, saturation, scaling, allocation), ranked cross-domain factors with materiality. Genuinely sophisticated. |
| Answers the CMO's core questions | **3** | The questions are *modeled* well, but several answers live off the executive page, and some (targets scoreboard, portfolio on executive) are not surfaced where a CMO looks. |
| Executive usability / decision-readiness | **2** | Prose-first, no KPI scoreboard, no targets-vs-actuals at a glance, single-account executive scope, unlabeled minor-unit numbers on Forecast. |
| Live-data readiness / production trust | **1** | No live gatherer exists; executive/workspace are empty on real accounts. The headline value is demonstrable only on a fixture. |
| Risk & data-quality surfacing | **4** | Clear separation of data problems from performance problems, severities, schema-drift safety states. |

---

## 7. Strengths
1. Intellectual honesty is enforced in code (trust tiers, withheld profit, fail-closed source isolation) — I would believe what it shows.
2. Every displayed signal is backed by a real deterministic computation with inspectable evidence, not canned strings.
3. Cross-domain causal structure (media + commerce + creative + history → one ranked diagnosis + one next action) is exactly how a CMO reasons.
4. Portfolio attention-ranking with no fake currency blending, and a targets engine that returns UNKNOWN rather than inventing a goal.
5. CI-enforced capability map + 51-question executable benchmark keep capabilities from regressing into unreachable backend functions.

## 8. Gaps
1. **No live data path** — executive/workspace show an empty state on real accounts; the flagship brief works only on the synthetic seed.
2. **No executive KPI scoreboard** — no spend/revenue/ROAS/CPA vs target vs prior-period headline numbers; prose-first layout.
3. **No targets-vs-actuals and no portfolio view on the Executive page** — "are we hitting targets?" and "which brands need attention?" are modeled but not surfaced where an executive reads.
4. **Monetary figures shown in raw, unlabeled minor units on the Forecast/commerce narrative** (`formatMoney` not applied) — a 100× readability/trust hazard.
5. **Single-account, hard-coded `PROFITABILITY_DECLINE` executive scope** — not portfolio-wide and assumes a decline framing.

## 9. Verdict

The trust architecture is the best I have reviewed and the analytical engines are real. But as an executive instrument today it is a **beautifully honest demo of an empty cockpit**: on my actual ad accounts the executive and workspace surfaces have nothing to say, and even in demo the layout makes me read prose and squint at unlabeled minor-unit numbers instead of seeing my KPIs against target. I would not run a weekly executive meeting off it yet. I would, however, pilot it the moment a live gatherer feeds real spend into the orchestrator and the executive page gains a KPI/targets scoreboard — the foundation that would make it trustworthy is already built.

**FINAL VERDICT: WOULD_PILOT**
