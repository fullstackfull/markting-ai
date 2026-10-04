# 08 — Data-Science / Statistical-Methodology Review

**Reviewer role:** Skeptical marketing data scientist (independent).
**Scope:** Statistical methodology in code — anomaly detection, baselines, forecasting, sample size, seasonality, saturation, incrementality/attribution language, experiment logic, uncertainty quantification, ratio handling, mixed currencies, reconciliation, and the dashboards that surface them.
**Date:** 2026-10-04. Model knowledge cutoff Jan 2026; no external web citations were required — all findings are grounded in repository code.

> **Headline:** The statistical core is *unusually* honest and disciplined — among the most methodologically-responsible marketing codebases I have reviewed. The code is almost pathologically careful to **under-claim** (no fabricated lift %, no fake causality, no blended-currency ratios, evidence-gated INSUFFICIENT_EVIDENCE). The real weaknesses are *absences*, not overclaims: no inferential significance testing on observed deltas, forecast bands with no stated coverage probability, un-calibrated "magic" thresholds that have never been backtested, and showcase dashboards that currently compute on **synthetic seed data**.

---

## 1. Where the methodology lives

The "stats/intelligence in `lib/markting/*`" described in the brief resolves to **`platform/apps/cloud/lib/markting/`** (not `lib/markting`). The Python `engine/` is a paid-media *agent* (reports/admin), **not** a statistics engine — all quantitative methodology is TypeScript:

- `intelligence/` — anomaly, trend, forecast, confidence, diagnostics, analysis, pacing, scaling, health, cross-channel, cross-campaign, creative, normalize, explainability, impact, decision-model.
- `optimize/` — response-curve (saturation/marginal), experiment-model (causal ceiling), sample (power), outcome, decision, trace.
- `commerce/` — reconciliation (platform-vs-merchant, FX guard), metrics (MER), profit.
- `outcomes.ts`, `data-trust.ts`, `learning.ts`, `outcome-dashboard.ts` — outcome evaluation + effectiveness ledger.
- `orchestrator/sections.ts` — binds the real engines to dashboards/assistant.

---

## 2. Dimension scores (0–5)

| Dimension | Score | One-line basis |
|---|---|---|
| Ratio handling | **5** | Ratios recomputed from base totals, never averaged (`analysis.ts:67-73`). Lone exception: forecast CPA (see §3.2). |
| Mixed-currency safety | **5** | Airtight: cross-currency ratios/deltas → undefined/NOT_COMPARABLE; no model FX; governed FX only. |
| Incrementality / attribution honesty | **5** | Causal ceiling by study type; before/after capped at TEMPORAL_ASSOCIATION; conservative attribution; no fake multi-touch. |
| Anomaly detection | **4** | Robust modified z + dual material gate + point-excluding baseline + anchored seasonality + alert-storm cap. |
| Baselines & period comparison | **4** | Point-excluding robust baselines; but **no significance test** on the deltas. |
| Saturation / response curve | **4** | Validity-range, no extrapolation, conservative diminishing-returns slope, multi-signal. |
| Experiment logic | **4** | Honest study-type/causal classification, structured hypothesis, sample gate, contamination detection. |
| Reconciliation | **4** | Variance classified not alarmed; enumerated explanations; low-sample threshold widening; FX guard. |
| Forecasting & uncertainty bands | **3** | Transparent + banded + limitations, but band coverage **unlabeled**, iid assumption violated, CPA mean-of-ratios bias. |
| Sample size / significance | **3** | Correct MDE "rule-of-16" in *conversions* for experiments + n≥30 floor; but **no significance testing on observed deltas**. |
| Seasonality | **3** | Honest day-of-week only (anchored, never inferred); no annual/holiday/promotional/trend decomposition. |
| Uncertainty quantification | **3** | Categorical confidence capped by weakest factor (good, honest) but **not calibrated/numeric**; bands lack coverage. |

**Composite scientific-rigor score: ~4.0 / 5** — high, driven by honesty and evidence discipline; held back by the absence of inferential testing and calibration.

---

## 3. Specific rigor findings & overclaim audit

### 3.1 Forecast bands carry no coverage probability (moderate — overclaim-by-omission)
`forecast.ts:43` sets the band as `estimate ± dailyStd·√horizon` (cumulative) and `forecast.ts:69` as `mean ± 1·std` (CPA). This is a **±1σ ≈ 68%** interval under normality+iid, but it is surfaced as a bare "band low–high":
- `orchestrator/sections.ts:69` → `"Projected …-day spend ≈ X (band low–high)"`
- `orchestrator/sections.ts:380` and the executive/account dashboards (`app/dashboard/executive/page.tsx:25`, `app/dashboard/accounts/[accountId]/page.tsx:53`) render the same.

A reader naturally reads "band X–Y" as "the outcome will fall here," but it is only ~68%, not 90/95%, and the daily-ad-spend **iid assumption is violated** (autocorrelation, weekly seasonality, trend — the very things the `limitations` string says it ignores). The band's *probability content* is never stated. `√horizon` scaling (random-walk variance growth) is also inconsistent with the deterministic `mean·horizon` point estimate. The `limitations` array is honest about *method* but silent about *coverage*.

### 3.2 CPA forecast is a biased mean-of-ratios (genuine methodological bias)
`forecastCpa` (`forecast.ts:53-70`) returns the **mean of daily spend/conversion ratios**. The quantity a buyer means by "CPA" is the pooled ratio `Σspend / Σconversions`. Mean-of-daily-ratios overweights low-conversion (high-CPA) days, biasing the estimate **upward** and inflating its variance. This is the one place the codebase's otherwise-strict "never average a ratio" rule (`analysis.ts`) is broken — ironically to avoid summing a ratio. Zero-conversion days are correctly dropped, but that worsens the low-volume bias. Framed as "trailing moving average of the daily ratio," which is accurate but not what the label "CPA" implies.

### 3.3 No inferential significance testing on observed deltas (the central gap for a "data-science" claim)
`comparePeriods` / `diagnoseEntity` report percent deltas and a **categorical** confidence, but never test whether a CPA/ROAS/CVR move is distinguishable from sampling noise given the conversion counts. A +12% CPA move on 35 conversions clears "material" and can read MEDIUM confidence, yet may be pure noise. Confidence factors (sample ≥30, |signal| ≥15%, trust tier) are **heuristic proxies for** significance, not a test. The code is explicit and honest that "a calibrated numeric model is Phase 3+ … outcome data we do not have" (`confidence.ts:3-6`, `data-trust.ts:48-52`). Honest, but it means every "HIGH confidence" has **no measured hit-rate**.

### 3.4 Un-calibrated "magic" thresholds, no sensitivity/backtest (moderate)
Pervasive hard-coded constants with no empirical tuning or sensitivity analysis: `z=3.5`, `minPct=25` (anomaly); `MIN_SAMPLE_FOR_CONFIDENCE=30`; confidence caps at 5%/15% signal; saturation "diminishing" at `<0.7×` earlier slope; reconciliation `15%/35%`; fatigue `−20%` CTR; HHI `0.25/0.5`; structural-shift `5·MAD`. All *reasonable and conservative*, but none is derived from or validated against data. They should be read as expert priors, not calibrated parameters. The effectiveness ledger (`learning.ts`) that could backtest them explicitly carries **"no global accuracy score"** (`learning.ts:70`) — so confidence/thresholds are never closed-loop validated.

### 3.5 Showcase dashboards run on synthetic seeds (maturity/trust gap)
`orchestrator/sections.ts:1-9`: the seed figures are **synthetic, passed to the engines "as if platform-reported so the computation runs,"** while surfaces mark the deployment DEMO. The executive and account dashboards therefore display forecasts/anomalies/reconciliation computed over fabricated seeds. The *engines* are real and the `analyze.ts` path is the single live intelligence path, but a reviewer should not mistake the currently-rendered dashboard numbers for live analysis. The DEMO marking is the only guard.

### 3.6 Anomaly early-point baseline has lookahead (minor)
`anomaly.ts:110-113`: when fewer than `minBaselinePoints` priors exist, the baseline is leave-one-out over the **whole** series — i.e. the earliest points are judged against *future* data. Defensible for retrospective batch detection, but it is not an online/causal detector and could mask or manufacture an early-point flag against its own future.

### 3.7 Seasonality is day-of-week only (minor, honestly scoped)
`anomaly.ts` deseasonalizes DoW only, and **only** with anchored `weekdays` (never inferred from `index%7` — a prior bug that was correctly removed). Forecast assumes no seasonality at all. For the target region, Ramadan/holiday/payday/promotional seasonality is unmodeled. Honestly flagged, but a real limitation for forecasting.

### 3.8 Correct log-ratio decomposition (verified, strength)
`diagnostics.ts:182-218`: `ln CPA = ln CPM − ln CTR − ln CVR` and `ln ROAS = ln conv + ln AOV − ln spend` are **algebraically exact** (unit constants cancel in the delta). Shares = `|Δln factor| / Σ|Δln|`, with direction filtering so an offsetting factor is never named as the cause (`driversInDirection`). Explicitly labeled "a decomposition, never a causal claim." This is textbook-correct variance attribution.

---

## 4. Strengths (top 5)

1. **Currency safety is airtight.** Monetary ratios (CPC/CPM/CPA/ROAS) are left `undefined` across blended currencies; cross-period deltas across different single currencies are flagged NOT_COMPARABLE; no model-supplied FX is ever accepted — only governed `FxRate{source,asOf}` (`analysis.ts:63-73,146-148`, `reconciliation.ts:136-142`, `cross-channel.ts`).
2. **Ratios recomputed from base totals, never averaged** — avoids the classic ratio-of-means / Simpson error at the aggregate layer (`analysis.ts:aggregate`).
3. **Robust statistics done right.** Median+MAD modified z-score (0.6745 scaling) with mean/σ fallback; baseline **excludes the judged point** (de-masking); dual statistical+material gate; alert-storm suppression (`anomaly.ts`, `trend.ts`).
4. **Exemplary causal honesty.** Causal ceiling by study type (before/after → TEMPORAL_ASSOCIATION max); contamination detection forces CONTAMINATED over a verdict; saturation/fatigue/cannibalization are always "SIGNAL (not proven)"; expected impact is **direction only**, never a fabricated "+23% ROAS" (`experiment-model.ts:96-105`, `outcomes.ts`, `response-curve.ts`, `impact.ts`, `cross-campaign.ts:56-64`).
5. **Evidence floor + full explainability.** Synthetic/thin/stale/incomplete/mixed-currency → INSUFFICIENT_EVIDENCE rather than manufactured certainty; every claim carries a machine-readable `EvidenceRef` with the exact calculation; categorical confidence is **capped by the weakest factor, never averaged up** (`data-trust.ts`, `confidence.ts`, `explainability.ts`). The sample-size `requiredConversionsPerArm` even documents and fixes a prior unit bug (returned visitors, now conversions via MDE rule-of-16, `sample.ts:25-47`).

---

## 5. Rigor gaps (top 5)

1. **No significance testing on observed period deltas** — categorical confidence is a heuristic proxy, not a test; a material % move on a small conversion count can read MEDIUM/HIGH confidence while being noise (§3.3).
2. **Forecast bands have no stated coverage** (~68% ±1σ sold as "band"), rest on a violated iid assumption, and surface in dashboards without that caveat (§3.1).
3. **CPA forecast mean-of-ratios bias** — upward-biased vs pooled CPA; the one broken ratio rule (§3.2).
4. **Thresholds are expert priors, never calibrated or backtested**; the outcome ledger explicitly refuses a global accuracy score, so confidence has no measured hit-rate (§3.4).
5. **Showcase dashboards compute on synthetic seeds** — real engines, demo inputs; trustworthy only because of the DEMO marking (§3.5).

---

## 6. Scientific-rigor verdict

This codebase is a rare case where the primary risk is **not** overclaiming — the authors have built a disciplined machinery of currency gates, robust estimators, evidence floors, causal ceilings, and machine-readable explainability, and they repeatedly choose INSUFFICIENT_EVIDENCE / SIGNAL(not proven) / direction-only over fabricated certainty. On *methodology honesty and ratio/currency/causal correctness* it scores a genuine 4–5.

What keeps it from being a system I would trust to steer spend daily on its own: it is a **deterministic heuristic/triage engine, not yet an inferential one.** There is no significance test on the deltas it flags, no calibration of its confidence against realized outcomes, forecast intervals without coverage, and the current user-facing surfaces run on synthetic seeds. These are the exact things a skeptical data scientist must verify before letting a tool move money. They are acknowledged in-code as "Phase 3+" — but acknowledged is not implemented.

As a decision-support, explainability, and anomaly-triage layer alongside a human analyst's own work, it is trustworthy precisely because of its restraint. As an autonomous daily driver, it is not there yet.

**Final verdict: WOULD_USE_AS_SECONDARY_TOOL**
