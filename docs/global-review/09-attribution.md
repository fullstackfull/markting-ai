# 09 — Attribution & Measurement Review (MARKTING-AI)

**Reviewer role:** Independent attribution & measurement expert, product-maturity council.
**Method:** Grounded in source code; every claim cites a file path. Brutally honest. Web research not required for
these findings (all claims verifiable in-repo). Date: 2026-10-04.

> Note on the brief's path: the brief pointed to `lib/markting/*`; the actual code lives under
> `platform/apps/cloud/lib/markting/*`. All citations below use the real paths.

---

## Executive summary

On the question that matters most for this role — *does the product mislead users by comparing or combining
incompatible attribution systems?* — MARKTING-AI is, at the **library/engine level, one of the most disciplined
attribution codebases I have reviewed.** It encodes, as first-class typed invariants, nearly every rule a serious
measurement practitioner would want: platform-attributed value is explicitly *not* merchant revenue; cross-channel
ROAS/CPA are gated behind a comparability check and *never summed*; currencies are never blended without a governed
FX rate; before/after is never called causal; UTM is never treated as deterministic attribution; MER is always
carried with its revenue basis and ad-spend scope.

However, there is **one real, prominent misleading-comparison risk** where the product's own UI bypasses its own
library gate (the Overview KPI tile, see Risk 1), plus honest-but-material capability gaps (no incrementality
engine, no statistical significance). The engine is excellent; the weakest link is a headline dashboard tile and the
general absence of causal/incremental measurement.

---

## Evidence by dimension

### 1. Platform-attributed conversions & cross-channel comparison

`intelligence/cross-channel.ts` is the centerpiece and it is excellent. `checkComparability()`
(lines 32–67) validates currency, attribution basis, conversion definition, timezone, date-range overlap and trust
tier before *any* provider-vs-provider comparison, returning `COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE`
with reasons. The module docstring (lines 1–8) states the intent explicitly: *"ROAS/CPA are never summed or ranked
across incompatible data — a fake 'cross-platform winner' from incomparable inputs is exactly what this gate
prevents."* `compareChannels()` (lines 77–97) produces a **pairwise ranking only, never a sum**, upgrades CPA to
`NOT_COMPARABLE` when currency is unknown (lines 81–84, correct: CPA is currency-denominated), and attaches a caveat
on partial comparability. Hard blockers (currency mismatch, no date overlap, synthetic/unverified tier) force
`NOT_COMPARABLE` (lines 57–62). This is textbook-correct.

The seeded cross-channel section (`orchestrator/sections.ts:337–345`) even hard-codes a user-facing caveat:
*"Conversion definitions differ, so compare with care."*

### 2. Blended metrics / MER

`commerce/metrics.ts#computeMER` (lines 34–58) is a model of disciplined design: MER carries `basis`
(gross/net/contribution), `adSpendScope`, `window`, `currency`, `mixedCurrency`, and `trust`. Critically it
**refuses to compute MER from platform-attributed value** — `source: 'platform'` returns
`notComputableReason: 'revenue is not merchant-sourced — platform-attributed value is not MER revenue'` (line 54).
Mixed currency and zero ad-spend also yield typed non-computable reasons (lines 55–56). Blended CAC
(`metrics.ts:92–108`) refuses a number unless ≥50% of orders have reliable customer identity. Observed LTV
(`metrics.ts:127–163`) is labelled `OBSERVED_LTV`, never `PREDICTED_LTV`, and withholds on insufficient identity or
mixed currency. The ratio-safety layer (`orchestrator/ratios.ts`) degrades every ratio (ROAS/MER/CTR/CVR/CPA/CAC) to
an explicit typed `UNKNOWN` (ZERO_DENOMINATOR / MISSING_INPUT / MIXED_CURRENCY / INCOMPATIBLE_PERIOD) rather than 0,
NaN or Infinity.

### 3. Attribution windows / first/last-click assumptions

`commerce/reconciliation.ts#attributionView` (lines 112–120) classifies merchant-side attribution conservatively:
hashed click-id → `DIRECTLY_TAGGED`; UTM/referrer → `MERCHANT_LAST_TOUCH` *explicitly flagged "not deterministic"*;
nothing → `UNATTRIBUTED`. The docstring (lines 107–111) states multi-touch precision is *deliberately deferred* —
the product does not fake multi-touch. Attribution basis is carried through normalization
(`intelligence/normalize.ts:38,66`) and a *change* in attribution basis between windows is detected as contamination
(`outcomes.ts:101`, `optimize/contamination.ts:47–49`, which escalates to `INVALIDATED`). There is **no silent
first/last-click assumption**; whatever basis the platform reports is carried as a label, never normalized away.

### 4. Platform vs merchant reconciliation / commerce truth

`commerce/reconciliation.ts#reconcile` (lines 52–102) is strong. It never expects platform == merchant, enumerates
10 legitimate variance causes (lines 42–46: attribution windows, cross-device, view-through, duplicate events,
refunds, payment failures, timezone, currency, consent/tracking loss, platform modelling), widens thresholds for
small samples (lines 74–78), and marks `sampleSufficiency: LOW` below 25 orders so a large % gap on a handful of
orders is not alarmed on as systematic (lines 24, 79–89). A currency mismatch short-circuits to `NOT_COMPARABLE`
(lines 64–66). `diagnostics.ts#diagnoseCommerce` surfaces precisely the cases where platform metrics overstate
business truth — `PLATFORM_ROAS_EXCEEDS_MERCHANT`, `ROAS_UP_MARGIN_DOWN`, `REVENUE_UP_PROFIT_DOWN`,
`REFUNDS_ERODE_NET_REVENUE`, `BELOW_BREAK_EVEN` — with the stated principle *"ad-platform metrics must NOT dominate
merchant truth"* (lines 1–8). This directly counters the industry's most common self-deception (trusting platform
ROAS as business performance).

### 5. Causal claims / incrementality

Causal restraint is **excellent**; incrementality *capability* is **absent** (and honestly so).
`outcomes.ts#evaluateOutcome` caps any post-change improvement at `OUTCOME_ALIGNED_WITH_RECOMMENDATION` /
`TEMPORAL_ASSOCIATION` and states in user-facing text *"This is temporal alignment with the recommendation, not
proven causation"* (lines 122–134). The `CAUSAL_EXPERIMENT_SUPPORTED` stance exists in the enum (line 17) but the
experiment layer (`optimize/contamination.ts`) only classifies experiment *validity*
(`VALID / CONTAMINATED / INVALIDATED / INCONCLUSIVE`) — **there is no lift computation, no holdout/ghost-ads, no
geo-lift, no media-mix model (MMM).** Grep for `increment|lift|holdout|mmm|geo` finds only commerce-sync
"incremental cursor" and the word "holdout" in a *synthetic seed* experiment title (`orchestrator/seed.ts:204`), not
a measurement engine. So the product cannot today answer "is this spend incremental?" — it can only compare
platform-claimed efficiency and reconcile against merchant revenue. This is a genuine capability gap for a
"measurement" product, but it is paired with honesty (it never fabricates incrementality).

### 6. Statistical rigor / confidence

`intelligence/confidence.ts` derives **categorical** LOW/MEDIUM/HIGH confidence by capping on the weakest factor
(trust tier, sample, completeness, freshness, attribution consistency, signal strength), never averaging upward
(lines 38–71). The docstring is candid: *"a calibrated numeric model is Phase 3+ … We stay CATEGORICAL"* (lines
1–6). `data-trust.ts` enforces a `MIN_SAMPLE_FOR_CONFIDENCE = 30` floor and explicitly says *"This is a conservative
gate, NOT a statistics engine: it does not compute significance"* (lines 1–7, 52). Honest, but it means no
confidence intervals, no p-values, no power analysis — users get direction + categorical confidence, not statistical
significance.

### 7. Disclosure of attribution limitations

Strong where it exists. The Data Quality Center explicitly frames *"attribution mismatch … data problems that must
not be mistaken for business-performance problems"* (`app/dashboard/data-quality/page.tsx:16`). Commerce page
discloses profit is withheld when COGS is unknown (`app/dashboard/commerce/page.tsx:17`). Agency page states
*"Currencies are never blended into one fake total"* (`app/dashboard/agency/page.tsx:16`;
`orchestrator/sections.ts:281`). `docs/phase5/07-attribution-reconciliation.md` documents the whole reconciliation
model clearly. The gap is at the **Overview tile level** (Risk 1).

---

## Specific misleading-comparison risks

### RISK 1 (MATERIAL) — Overview KPI sums platform-claimed conversions across channels with no double-count disclosure
**File:** `app/dashboard/live-data.tsx:36–58`, labels in `lib/i18n/messages/overview.ts:24–25`.
The Overview reduces **all provider rows** into a single "Conversions" tile:
`conversions: sum.conversions + (row.metrics.conversions ?? 0)` across every connected platform (lines 36–40). The
code comment (lines 34–35) carefully justifies *not* summing money across currencies and *not* blending ROAS across
currencies — but it is silent on the fact that **summing platform-claimed conversions across Meta + Google + TikTok
+ … double-counts overlapping conversions** (each platform claims the same purchase via view-through / cross-device
within its own window). The same applies to the single-currency "blended" ROAS (line 56–57:
`value / spend` where both are summed across providers in that currency). The footnotes disclose only
`"Provider-reported"` and `"Conversion value ÷ spend"` — truthful about the source, but **no caveat that the total
over-counts.** This is the exact failure mode `cross-channel.ts` was built to prevent, and the Overview dashboard
bypasses that gate. Because this is the top-of-dashboard headline number, it is the single highest-impact
attribution risk in the product. **Fix:** label it "Platform-reported conversions (sum may double-count
cross-channel)" or show per-provider rather than a summed total, and route the blended ROAS through the comparability
posture used elsewhere.

### RISK 2 (MODERATE) — `aggregate()` sums conversions/conversion_value with only a currency guard
**File:** `intelligence/analysis.ts:42–79`. `aggregate()` sums base metrics including `conversions` and
`conversion_value` and recomputes ROAS/CPA from the sums. It correctly suppresses money ratios on mixed currency
(lines 67–73) and is currency-safe, but it has **no guard against aggregating multiple providers' platform-claimed
conversions** (no conversion-definition or attribution-basis check at this layer). It is safe when callers pass a
single provider/account; it would silently over-count if fed a multi-provider set. The protection currently lives in
the *caller's* discipline, not in `aggregate()` itself. Recommend the function flag `mixedProvider` /
`mixedAttribution` the way it flags `mixedCurrency`.

### RISK 3 (LOW/MODERATE) — MER vs platform ROAS can be juxtaposed without an explicit "different systems" caveat
`diagnostics.ts` handles the dangerous direction well (`PLATFORM_ROAS_EXCEEDS_MERCHANT`, `BELOW_BREAK_EVEN` compares
MER to break-even). But the commerce page bar chart (`app/dashboard/commerce/page.tsx:24–28`) places refund rate,
contribution margin % and a bare `MER` value on one axis; MER is a blended merchant-truth ratio and should always be
visually distinguished from platform ROAS so users don't mentally compare `MER 2.1` against a platform `ROAS 4.0` as
if they measure the same thing. The underlying `MER` object carries `adSpendScope`/`basis` (good) but the chart
renders only the scalar.

### RISK 4 (LOW) — "incrementality" absent; ensure UI never implies causal lift
No lift engine exists (Dimension 5). The risk is purely presentational: as long as no surface labels an
aligned-outcome or a platform-ROAS number as "incremental"/"driven by", the honesty holds. Current code is clean
here (`outcomes.ts` text is explicit), but this must be guarded as features grow.

---

## Strengths (top 5)

1. **Platform value ≠ merchant revenue is enforced by construction** — `computeMER` refuses platform-sourced revenue
   (`commerce/metrics.ts:54`); reconciliation and diagnostics exist precisely to catch platform overstatement.
2. **Cross-channel comparability gate** forbids summing/ranking incompatible attribution and produces pairwise,
   caveated rankings only (`intelligence/cross-channel.ts`).
3. **Causal restraint** — before/after is capped at temporal alignment, never causation; experiments degrade to
   CONTAMINATED/INVALIDATED rather than fabricating a verdict (`outcomes.ts`, `optimize/contamination.ts`).
4. **Currency honesty everywhere** — no invented FX; mixed-currency money ratios suppressed; governed FX only
   (`analysis.ts`, `ratios.ts`, `reconciliation.ts#compareMoney`).
5. **Typed non-computable reasons + sample-sufficiency gating** — ratios and reconciliation refuse to assert on thin
   data instead of manufacturing certainty (`ratios.ts`, `reconciliation.ts:24,79–89`, `data-trust.ts`).

## Gaps / risks (top 5)

1. Overview headline sums platform-claimed conversions across channels with no double-count caveat (Risk 1).
2. No incrementality/causal-lift measurement at all — no holdout, geo-lift, or MMM (Dimension 5).
3. No statistical significance / confidence intervals; confidence is categorical only (Dimension 6).
4. `aggregate()` lacks a mixed-provider/mixed-attribution guard parallel to its mixed-currency guard (Risk 2).
5. MER and platform ROAS can be visually juxtaposed as bare scalars without a "different measurement systems"
   separation (Risk 3).

---

## Scores (0–5)

| Dimension | Score | Rationale |
|---|---|---|
| Platform-attributed conversions handling | 4 | Library is excellent; Overview tile sums them (Risk 1) costs a point. |
| Blended metrics / MER | 5 | MER refuses platform source, carries basis/scope/trust; CAC/LTV gated. |
| Attribution windows & first/last-click | 4 | Basis carried + change-detected; UTM non-deterministic. No active window normalization (deferred). |
| Cross-channel comparison | 4 | Rigorous gate in lib; Overview bypasses it. |
| Commerce truth / reconciliation | 5 | Platform≠merchant enforced, variance classified with sample gating. |
| Causal claims restraint | 5 | Never claims causation; explicit temporal-alignment language. |
| Incrementality (capability) | 1 | No lift/holdout/geo/MMM. Honest absence, but absent. |
| Statistical rigor | 2 | Categorical confidence + sample floor only; no significance (self-disclosed). |
| Disclosure of limitations | 4 | Strong in library/docs/most pages; weak at Overview tile. |

---

## Verdict

**WOULD_USE_AS_SECONDARY_TOOL.**

Rationale: As an *attribution-hygiene and reconciliation* layer, this is genuinely best-in-class — I would trust its
cross-channel gate, its platform-vs-merchant reconciliation, and its MER/CAC/LTV discipline over most commercial
dashboards, which routinely sum platform-claimed conversions and present blended ROAS without caveat. But it is not
yet a primary *measurement* system: it has **no incrementality engine and no statistical significance**, so it cannot
answer "is this spend causal/incremental?" — the question a measurement lead ultimately needs. And its single most
visible number (the Overview Conversions/ROAS tile, Risk 1) commits, in the UI, the very cross-channel summing error
the library elsewhere forbids. Fix Risk 1 and Risk 2 (both small, localized changes) and it becomes a strong daily
*diagnostic/reconciliation* companion alongside a dedicated incrementality/MMM tool — not a replacement for one.
