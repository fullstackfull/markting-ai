# 10 — Data and Attribution Audit

**Lead:** B9 (data and attribution scientist). **Inputs:** specialist reports B1–B8
plus A12 (e-commerce profit), A13 (attribution), A15 (budget/scaling). **Method:** every
conclusion below is sourced to a `path:line` the lead re-verified by reading the code
(15 spot-check groups, ≈30 citations, all held — see `agents/B9.md`). Classification tags:
VERIFIED_CODE, VERIFIED_TEST, VERIFIED_RUNTIME, DOCUMENTED_ONLY, INFERRED, NOT_VERIFIED.
**Audit only — nothing was changed.**

> One-sentence thesis: the engine's arithmetic over whatever data it is handed is careful,
> deterministic and well-tested, but the *provenance and trust* machinery around that
> arithmetic is fixture-shaped — every gate that is supposed to say "this number is not
> trustworthy yet" (completeness, provider reconciliation, attribution compatibility,
> statistical sufficiency) is either off, tautological, or prose-only on the live path, so
> a number born at the lowest trust tier is rendered with the confidence of the highest.

---

## 1. How the numbers are produced

### 1.1 Two independent measurement engines

There are **two** code paths that each claim to compute "the metrics," with different
languages, precision models and null rules (B1-05, VERIFIED_CODE):

| | Engine (agent) | Platform (adport cloud / MCP) |
|---|---|---|
| Location | `engine/src/paid_media_agent/tools/compute.py` | `platform/packages/core/src/report-summary.ts` |
| Numeric type | Python `Decimal`, quantized to 1e-6 (`compute.py:71-75`) | JS `number` (float) (`report-summary.ts:19-31`) |
| Missing-metric rule for a sum | sum over rows that *have* the metric (`compute.py:49-68`) | `null` unless **every** row has it (`report-summary.ts:19-23`) |
| ROAS when value absent | ratio of summed value / summed spend | spend-weighted `spend*roas` reconstruction (`report-summary.ts:27-38`) |

The same account/window can therefore yield a different spend/ROAS/CPA depending on which
subsystem rendered it, and the two disagree on when a metric is `null` vs a number. There
is no cross-engine golden test. **(DA-09, P2.)**

### 1.2 The engine pipeline (the authoritative path)

```
provider payload ──reads.py──▶ normalize_rows ──▶ aggregate() ──▶ compare_platform() ──▶ compare_periods() ──▶ render.py
   (pipeboard /       (per-row typing,     (sum raw,      (per-platform deltas +   (cross-platform total,   (PDF/HTML
    direct/fixtures)   quality flags)       derive ratio) reconciliation checks)    suppression gate)        scorecard)
```

- **Normalize** (`normalize.py:126-160`): maps provider keys to a `PerformanceRow`; sets `INCOMPLETE_WINDOW` and `is_complete` **only when the provider supplied `data_complete_through`**, and `MISSING_METRIC` **only for conversions/conversion_value** (never impressions/clicks). Spend is scaled by a per-platform minor-unit map (`_SPEND_KEYS`, 6 platforms only).
- **Aggregate** (`compute.py:71-95`): sums raw metrics, then derives `ctr/cpc/cpm/cvr/cpa/roas` as ratios. `spend` is summed over **all** rows; `conversions`/`conversion_value` only over rows that reported them (`_sum_optional_decimal`, `compute.py:60-68`).
- **Reconcile** (`compute.py:216-248`): one unconditional self-check plus two provider checks that run only if the payload carried `totals`.
- **Combine** (`compute.py:278-331`): sums conversions/value across platforms and derives a blended CPA/ROAS, behind a suppression gate.
- **Render** (`render.py:123-172`): writes the cross-platform scorecard (all metrics) to the report; appends prose caveats to a `data_quality` footnote list.

Determinism is genuine and documented (`analysis.py:1` "Every number here is computed by
code, never by the model"), and the arithmetic invariants (never average ratios, zero/null
denominator → `None`, currency-mix hard error within a platform read) are
EXISTS_AND_STRONG (B1, A12, A13 all agree; `test_compute.py` passes).

### 1.3 Where the data actually enters (live vs fixture)

This is the crux. Everything protective in the pipeline keys off metadata that **fixtures
supply and live reads do not**:

| Metadata | Fixture source | Live source | Consequence |
|---|---|---|---|
| `data_complete_through` | `fixtures.py:201-214,363-367` (lag 2d) | `pipeboard.py:186-193` returns none; `x_ads.py`/`openai_ads.py` none | Every live row `is_complete=True`, no `INCOMPLETE_WINDOW` (B2-03, A13-03, B8-02) |
| `totals` (provider control) | `fixtures.py:386-391` | `reads.py:266` → `{}` | Provider reconciliation checks never fire; `reconciled` tautological (B1-01, B8-03) |
| `currency` / `timezone` | fixtures set them | `pipeboard.py:193` none → taken from local alias binding (`reads.py:247-248`) | No mismatch detection vs provider (B8-08) |

---

## 2. Where the numbers can mislead (consolidated defect catalogue)

Each row is a deduplicated team finding. Full severities and recommendations in the JSON;
IDs are the consolidated `DA-*` identifiers used throughout this document.

### P1 — financial / unsafe execution

- **DA-15 — Zero-decimal currency → 100× budget (A15-01, VERIFIED_CODE).** `platform/packages/meta/src/provider.ts:20` hardcodes `CENTS_TO_MICROS = 10_000` and applies it with no currency check (`:333,334,452,522,523,568,614`); `translate.ts:107` does the same. A ¥30,000 Meta budget is written as ¥3,000,000. The percentage-delta cap compares micros-to-micros so it is blind to the error. Latent today (demo/fixtures are USD) but on the live-write path.

### P2 — serious financial / reliability risk

- **DA-01 — Cross-platform total blends incompatible attribution into one CPA/ROAS (A13-01, B2-02, A12-04, VERIFIED_RUNTIME).** `compute.py:278-298` sums conversions/value across platforms; the suppression gate (`compute.py:309-331`) checks currency/completeness/missing-metric/window-dates but **not attribution**. A probe mixing Meta `7d_click_1d_view` with Google click-based conversions produced `conversions=70 cpa=20 roas=5`, `suppressed=None`, `flags=[]`. The blended scorecard is rendered to the report (`render.py:123-134`); the only mitigation is a footnote caveat when `len(platforms)>1` (`render.py:169-171`) and a spend-only model summary (`compute.py:406`).
- **DA-03 — Conversion-lag protection is fixture-only; live days never flagged incomplete (B2-03, A13-03, B8-02, VERIFIED_CODE).** See §1.3. Yesterday's still-maturing conversions are treated as final; period deltas understate the current window vs a matured previous window.
- **DA-04 — `reconciled=yes` is tautological for live data (B1-01, B8-03, VERIFIED_RUNTIME/CODE).** The only unconditional check (`entity_rows_sum_to_platform_spend`, `compute.py:216-224`) compares the entity-spend sum to the platform spend — both derived from the same rows, so it always passes. Provider checks require `totals`, which live reads never carry. `reconciled` means "internally self-consistent," not "agrees with the ad platform."
- **DA-05 — `render_report` stamps `reconciled: true` unconditionally (B8-04, VERIFIED_CODE).** `reports.py:67` hardcodes `report_summary(..., reconciled=True)`; `reconcile_report` only checks value-fidelity (`render.py:204-236`). A report whose per-platform reconciliation *failed* still returns the headline boolean `reconciled: true` while listing the failure in the body.
- **DA-06 — Partial-conversion ratios: CPA over full spend ÷ partial conversions (B1-02, A13-10, VERIFIED_RUNTIME).** `compute.py:60-68` sums conversions only over present rows while spend is summed over all rows (`:76`). Probe: 7 days × $100 with conversions on 2 days (10 conv) → `cpa=70`, true converting-day CPA $20 — a ~3.5× distortion, emitted as an authoritative figure.
- **DA-07 — Partial impressions/clicks silently undercount totals and distort ratios (B8-01, B8-06, VERIFIED_RUNTIME).** `MISSING_METRIC` is set only for conversions/value (`normalize.py:143-144`); impressions/clicks gaps set no flag. Probe: day-2 impressions missing → `aggregate.impressions=1000` (true 2000), `ctr=0.20` (true 0.10), `missing=()`. Suppression keys on `MISSING_METRIC` so the bad window is not suppressed.
- **DA-08 — Conversion-definition conflation within and across platforms (A13-02, B7-04, B7-06, VERIFIED_RUNTIME/CODE).** `normalize.py:28` treats `conversions`/`purchases`/`results` as one column (first present wins per row); the cross-platform sum then mixes Google all-conversions, Meta purchases, Apple installs (`apple:200`), Pinterest checkouts (`pinterest:17`), Reddit click+view (`reddit:230`). Nothing records which event each count represents.
- **DA-09 — Two divergent measurement engines (B1-05).** §1.1.
- **DA-10 — No statistical significance / sample-size engine; small-base noise is emitted as a flag (B3-01, B3-02, VERIFIED_RUNTIME).** No scipy/statsmodels/numpy dependency. The only "analysis" is arithmetic deltas; `summary.py:27,118-125` flags a day on relative change ≥50% with no absolute floor — a 2→3 conversion day is flagged `conversions_moved_up`. The structured signal the model consumes pushes toward over-reaction.
- **DA-11 — Proposals carry no evidence linkage and empty-defaulting plans; risk is operational-only (B3-03, B3-04, VERIFIED_CODE).** `write_tools.py:30-43`: `reason` is required free text, `measurement_plan`/`reversal_plan` default `""` and are never validated; there is no `analysis_artifact_id`, no sample size, no window. `classify_risk` (`writes.py:77-125`) derives flags from the operation name/values only. A budget cut backed by 36 conversions and one backed by 3,600 produce identical risk surfaces. **This is the single most important enabler of "recommend on insufficient data" — see §3.**
- **DA-12 — Cloud overview sums across currencies and its ROAS tile is structurally 0× (A12-01, A12-02, A13-06, VERIFIED_CODE).** `reads.ts:54` never requests `conversion_value`, so `live-data.tsx:40-41` computes `roas = 0/spend = 0`; `:33-41` sums spend/conversions/value across every row with no currency or provider grouping. The demo seed ships USD + a SAR Snapchat account (`sandbox-provider.ts:331`). Violates `reporting-semantics.md:15`.
- **DA-13 — Cloud read boundary discards the currency-safe summary and provider warnings (B8-05, VERIFIED_CODE).** `builtin.ts:138` returns `{rows, summary, truncated, errors, warnings}`; `reads.ts:53-58` keeps only `rows`/`truncated`. The vetted currency-grouped `summary` and the "currency lookup failed; keep separated" warning are dropped before the UI.
- **DA-14 — Sandbox synthetic data runs the production path with no per-row marker (B8-07, VERIFIED_CODE).** `sandbox-provider.ts:99-143` emits fully-"complete" synthetic metrics with no quality flag and no `synthetic:true` on report rows; `env.ts`/`runtime.ts:18-26` enable it via a single deploy-wide `MARKTING_DEMO_MODE` flag, reusing the real `PolicyEngine`, Postgres pending/audit and findings stores. Demo code can reach a production path; audit records are indistinguishable from real except by provider id. **Demo reaching production — the one case the brief asks to flag.**
- **DA-16 — Budget percentage cap bypassed when prior budget unknown; default policy has no absolute ceiling (A15-03, VERIFIED_CODE).** `engine.ts:143` skips the pct check when `fromMicros` is absent (every create; Apple update with unreadable prior); `policy.ts:15` defaults `max_daily_budget_micros` to `null`. Under the shipped default, a create can be assigned an arbitrary budget and pass policy.
- **DA-17 — `translate.ts` ignores the declared `unit` on the proposal field (A15-05, VERIFIED_CODE).** `translate.ts:86-92,148-152` always multiplies `after.value` by 1e6; the declared `unit` (`:21`) is dropped. The whole budget pipeline's correctness rests on an unvalidated convention between the Python engine and the TS bridge.
- **DA-18 — Providers coerce missing conversions to 0, contradicting the semantics doc; the zero-conversion rule then proposes a pause (A13-04, A12-07, VERIFIED_CODE/TEST).** Meta/Google/TikTok/Microsoft/Reddit/Apple emit `0` for absent conversions (e.g. `meta/src/provider.ts:591-594`), violating `reporting-semantics.md:13`. `core-performance.ts:8-29` flags `spend≥50 & conversions===0` as critical and attaches `pauseCampaign`, unable to distinguish a lead-gen campaign from broken tracking. Mitigated by the preview/approval gate.
- **DA-21 — Incrementality guardrail is prompt-only on the live path (B5-02, VERIFIED_CODE).** The "platform attribution ≠ incremental" rule lives only in `instructions.md:20` and wiki prose; no code in `writes.py`/`write_policy.py`/`summary.py` inspects or refuses an incrementality claim. The one code-level occurrence is a hardcoded demo literal (`demo_script.py:125-128`) that a test asserts exists (B5-03).
- **(engine funnel coverage)** — The engine normalizes a funnel for only 6 of its 10 platforms; TikTok/Pinterest/Snap/GA4 reads fall through to raw `provider_result` and cannot be computed on (B7-05, VERIFIED_CODE). Folded into DA-08's event-definition theme in the JSON.

### P3 — quality / correctness-at-the-margin

- **DA-19 — "Below break-even" = ROAS < 1.0, margin-blind (B6-06, A12-03).** `core-performance.ts:76-99`; true break-even is `1/contribution-margin`. False reassurance for any merchant with COGS.
- **DA-20 — Cross-platform total ignores timezone mismatch (B1-07, A13-07, VERIFIED_RUNTIME).** `compute.py:325` compares only `(start,end)`; a Riyadh and an LA account on the same date label are combined. `TIMEZONE_MISMATCH` defined, never set.
- **DA-24 — Pacing uses active-day denominator; `over_budget` can mislabel under-delivery (B1-09, A15-07, B4-07).** `summary.py:88-104` divides by days-with-rows; a 2-of-14-day burst reads over-budget. The field label implies window-day averaging.
- Also P3: day-over-day change compares nearest present day not calendar-adjacent (B1-08); payload-level attribution labels from direct adapters dropped (A13-08, B2-01); engine X adapter reads one placement while platform reads three (A13-09); within-provider CPA across different primary conversion actions (A13-11); currency/timezone taken from alias with no mismatch detection (B8-08).

### GAP — missing capability, not a defect (code does not claim it)

- **DA-02 — `ATTRIBUTION_DIFFERS` and 4 other quality flags are declared but never produced (B2-01, B8-09, A13).** `common.py:59-65` defines `SOURCE_UNAVAILABLE`, `CURRENCY_MISMATCH`, `TIMEZONE_MISMATCH`, `ATTRIBUTION_DIFFERS`, `STALE_CATALOG`; `rg` finds zero producers. The taxonomy overstates implemented coverage.
- **DA-22 — No LTV / CAC / payback / cohort / store-verified revenue / MER (B6-01…05, A12-08).** The only "value" is platform-attributed `conversion_value`. No store/CRM/warehouse ingest; `docs/TODO.md:14-16` is honest that it "does not exist yet."
- **DA-23 — No forecasting / trend / seasonality / Ramadan-Eid / locale-week awareness (B4-01…07).** No stats/time-series code anywhere; notable for an Arabic-first MENA product.
- No incrementality/holdout/geo-lift capability (B5-01); only a 3-stage funnel, no landing/add-to-cart (B7-01…03); no budget optimization/scaling/marginal-ROAS/allocation (A15-06).

---

## 3. Every location where the AI could recommend on insufficient data

These are the concrete `path:line` points where a recommendation can be formed or acted on
with no data-sufficiency check in the way. This is the question the workstream exists to
answer.

1. **`summary.py:118-125` — day-anomaly flag with no absolute floor.** A 2→3 conversion day emits `conversions_moved_up` into the structured `flags`/`flagged_days` the model reads. VERIFIED_RUNTIME (B3-02). *The model is handed a "signal" that is pure noise.*
2. **`compute.py:98-114, 349-372` — deltas and "largest absolute mover" attention lines.** Relative % change on any base, with no variance/CI/significance. A 100% swing on a base of 1 looks identical to a real trend (B3-01, A15-06).
3. **`compute.py:278-298` + `render.py:123-134` — blended CPA/ROAS over mixed attribution** feeds the report scorecard that a budget-shift argument rests on (DA-01).
4. **`compute.py:60-92` — per-entity/per-platform CPA/ROAS on partial-conversion or partial-impression windows** (DA-06, DA-07), still emitted in headlines (`compute.py:389-390`).
5. **`write_tools.py:30-43` — `propose_change` accepts a recommendation with no `analysis_artifact_id`, no sample size, and a blank-able `measurement_plan`** (DA-11). *Nothing in the proposal pipeline can tell whether the change is backed by sufficient data.*
6. **`writes.py:77-125` — `classify_risk` is blind to data basis** (DA-11): the human approval card cannot distinguish a well-evidenced change from an under-powered one.
7. **`core-performance.ts:8-29` — `zero-conversion-spend` rule proposes `pauseCampaign`** on a conversion count that may be 0 only because the provider coerced a missing non-purchase metric to zero (DA-18).
8. **`core-performance.ts:53-74` — `cpa-outlier` rule** flags campaigns >2.5× the account-median CPA and says "shift budget," comparing campaigns with different primary conversion actions (A13-11).
9. **`core-performance.ts:76-99` — `negative-roas`/"below break-even"** uses a margin-blind ROAS<1 threshold (DA-19).
10. **`demo_script.py:158-170` — the canonical end-to-end pattern** hardcodes a budget cut on a ~3-conversion/day campaign with a 7-day (~21-conversion) measurement plan, derived from no artifact. It is a fixture, but it encodes the intended live behavior: recommend → propose → execute with zero sample-size awareness (B3-06, A15-06).

The backstop in every case is (a) unenforced prose guidance to the model
(`anomaly-and-significance.md:21-40`, `instructions.md:16-17,20`) and (b) the human
approval gate on writes. Both are real but neither is a deterministic data-sufficiency
check, and no eval tests restraint on thin data (B3-05, B5-04).

---

## 4. The T0–T5 data-trust model mapped to current code

Synthesizing B8's engine trust ladder with A12's e-commerce profit tiers. **The core
failure mode: live data enters at T1 and is rendered with T3/T4 confidence** because the
gates that should hold it back are fixture-only or tautological.

| Tier | Meaning | Where the code sits | Verdict |
|---|---|---|---|
| **T0 — Synthetic / demo** | Fabricated data; must never drive real decisions | `sandbox-provider.ts:99-143`, enabled deploy-wide into the real PolicyEngine/audit (`runtime.ts:18-26`); no per-row synthetic marker | Present but **leaky** (DA-14) |
| **T1 — Raw provider, completeness unknown** | Live read, not yet validated | Live Pipeboard (`pipeboard.py:186-193`): no `data_complete_through`/`totals`/`currency` | **All live data actually sits here**, yet is presented with T2/T3 confidence |
| **T2 — Normalized + flagged** | Rows typed, gaps flagged | `normalize.py` emits `INCOMPLETE_WINDOW`/`MISSING_METRIC` | Fully exercised only for fixtures; live skips most flags (DA-03, DA-06, DA-07) |
| **T3 — Reconciled to provider totals** | Rows agree with the platform's own control totals | `compute.py:225-248` | **Fixture-only**; live `reconciled` tautological (DA-04) and the report labels it `true` regardless (DA-05) |
| **T4 — Cross-platform compatible total** | One currency/window/attribution-compatible total | `compute.py:309-331` | Gate logic sound for currency/window, but **attribution and timezone are not checked** (DA-01, DA-20), and its completeness inputs are the under-firing T2 flags, so a T1 input can still produce a T4 total |
| **T5 — Business-verified truth** | Store net revenue after returns, COGS/fees, true profit/MER | — | **MISSING** (DA-22): ROAS is platform-attributed `conversion_value/spend` only; no store/order/refund/COGS reconciliation |

Promotion rule a world-class system would enforce (none exists today): a figure may be
*displayed* at its true tier and may *drive an automated or proposed action* only at or
above a tier set per action class — e.g. diagnostics at T1+, budget proposals at T3+,
"profitable/incremental" wording at T5 only.

---

## 5. The recommendation-confidence contract

Today a recommendation is a free-text `reason` plus optional free-text `measurement_plan`
/`reversal_plan` (`write_tools.py:30-43`), and "confidence" is a word the model may write
(`instructions.md:16`) with no computation behind it (B3, B6-05). The contract below is
what every recommendation — whether a report sentence or a `propose_change` — should be
required to carry, with **deterministic rules that forbid over-claiming on thin data.**

### 5.1 Required fields

| Field | Definition | Source today | Required change |
|---|---|---|---|
| **Recommendation** | The action (e.g. "reduce daily budget 20%") | free text | keep, but numeric magnitude must be code-derived or flagged `operator-specified` |
| **Reason** | Why | `reason` free text | keep |
| **Evidence** | The exact artifact(s) + window + sample size it rests on | **absent** | add `analysis_artifact_id`, window dates, observed conversions/clicks, `data_complete_through` |
| **Confidence** | A tier keyed to data sufficiency + trust tier, not prose | prose only | compute from §5.2 rules |
| **Risk** | Operational + **statistical** risk | operational only (`classify_risk`) | add data-basis dimension |
| **Expected impact** | Projected effect with an interval | absent | require a range, never a point promise on thin data |
| **Alternative** | What else could be done / "gather more data" | absent | require at least "wait N days" when confidence is low |
| **Required approval** | Human gate + the tier that unlocks it | approval exists; tier does not | gate approval level on confidence/trust tier |
| **Rollback** | How to reverse | `reversal_plan` free text (blank-able) | require non-empty for budget/status-flip ops |

### 5.2 Deterministic rules that forbid "increase budget 30%" on thin data

These are enforcement rules a compute/policy layer must apply **before** a recommendation
is surfaced or a proposal accepted. Each maps to a current gap:

1. **No numeric magnitude claim without a code-derived basis.** A sentence of the form "increase/decrease budget X%" is permitted only when X is produced by a deterministic allocation/marginal tool (none exists — A15-06) or is explicitly tagged `operator-specified`. Forbids the LLM inventing "30%". *(closes the gap behind DA-11.)*
2. **Minimum sample before a rate-metric recommendation.** A recommendation that leans on CPA/CVR/ROAS requires observed conversions ≥ a floor (e.g. ≥ N in the window) and clicks ≥ a floor; below it, confidence is forced to "insufficient data" and the magnitude claim is suppressed. *(closes DA-10; the 2→3 flag would be demoted.)*
3. **No recommendation on an immature window.** If the current window includes days past `data_complete_through` (or `data_complete_through` is unknown — the live default), the window is `immature`; recommendations are blocked or down-tiered. *(closes DA-03.)*
4. **No ratio claim on a partial-basis metric.** If the numerator and denominator do not cover the same row/day set, the ratio is `unavailable` for recommendation purposes, not a precise number. *(closes DA-06, DA-07.)*
5. **No blended-attribution claim.** A recommendation citing a cross-platform CPA/ROAS is blocked when platforms differ in attribution model/window/conversion definition (set `ATTRIBUTION_DIFFERS`); the system may cite per-platform figures only. *(closes DA-01, DA-02, DA-08.)*
6. **No "profitable" / "incremental" / "break-even" wording below the required trust tier.** "Profitable"/"ROAS below break-even" require T5 (store margin); "incremental" requires T5 + experiment evidence. Until then the permitted wording is "platform-attributed" / "gross ROAS < 1.0". *(closes DA-19, DA-21, DA-22.)*
7. **Reconciliation must be earned.** A recommendation may claim agreement with the platform only when a provider control total reconciled (tri-state: `reconciled`/`not_reconciled`/`no_external_oracle`); the tautological self-check alone yields `no_external_oracle`. *(closes DA-04, DA-05.)*
8. **Proposals must cite evidence and carry a non-empty measurement + rollback plan** for budget/status-flip operations, and the approval card must show the sample size and trust tier. *(closes DA-11.)*
9. **Synthetic data can never produce a real recommendation.** A proposal whose evidence artifact was produced by a `sandbox`/synthetic provider must be refused at the write/apply boundary under a non-demo org. *(closes DA-14.)*

### 5.3 Confidence tiers (illustrative, to be computed not narrated)

- **High** — matured window (past `data_complete_through`), sample above floor, provider-reconciled, single attribution model, trust tier ≥ required for the action.
- **Medium** — one of {immature window, sample near floor, reconciliation `no_external_oracle`} but not a blocking rule; magnitude claims allowed only as a range.
- **Insufficient** — any blocking rule in §5.2 trips; the only permitted recommendation is "gather more data / wait N days," no magnitude, no profit/incremental wording.

---

## 6. Disagreements — docs the code contradicts (consolidated, each re-verified)

| Claim | Where | What the code does | Finding |
|---|---|---|---|
| "a reconciled report"; "all sources complete and reconciled" | `tools/reports.py:92`, `render.py:174` | `reconciled` hardcoded `True`, tautological for live | DA-04/05 |
| cross-platform total "only when sources are compatible" | `compare_periods.py:140` | "compatible" never checks attribution or timezone | DA-01/20 |
| "Do not add their conversion counts as if deduplicated people" | `metrics-and-attribution.md:29-31` | `compute.py:278-298` + `render.py:123-134` adds them | DA-01 |
| "Missing metrics remain absent; no value becomes zero" | `reporting-semantics.md:13` | 6 providers coerce missing→0 | DA-18 |
| "Never sum monetary values across different currencies" | `reporting-semantics.md:15` | `live-data.tsx:33-41` sums across currencies | DA-12 |
| "last N days ends at `data_complete_through`"; "a recent day is still filling in" | wiki (`metrics-and-attribution.md:21-25`, etc.) | no live path sets `data_complete_through` | DA-03 |
| "State the window the read used" | `platform-playbooks.md:17-18` | direct adapters emit attribution; `reads.py` discards it | DA-02 (A13-08) |
| 10-value quality taxonomy implies broad coverage | `common.py:55-65` | 5 of 10 flags never produced | DA-02 |
| "confidence" is something the agent explains | `instructions.md:16-17` | no confidence computation exists; free-text only | §5 |
| budget units "account currency", changes "reversible/unit-safe" | `write-policy.example.toml` | minor-unit scaling 2-decimal-only; declared unit ignored | DA-15/17 |
| sandbox "enabled only by `MARKTING_DEMO_MODE`" bounds the risk | `sandbox-provider.ts:6-8` | flag is deploy-wide through the prod PolicyEngine/audit | DA-14 |

Docs the code **agrees** with (honest gaps, not contradictions): `docs/TODO.md:14-16`
(store revenue absent), `engine/docs/customization.md:157-175` (no warehouse connector),
`README.md` (claims only spend/conversions/CPA/ROAS). Forecasting/LTV/incrementality are
honestly scoped as absent — no public overclaim found.

---

## 7. What a world-class system would need (concrete)

1. **One canonical metric contract** (precision, rounding, null policy, ratio-basis rules) enforced by both engines, with a cross-engine golden test — ends DA-09.
2. **An `Attribution` descriptor on every row** (model, click/view windows, includes-view-through, conversion event, report-time basis) populated by each provider from the parameters it actually sent; the engine sets `ATTRIBUTION_DIFFERS` from it and suppresses blended conversions/CPA/ROAS when signatures differ — ends DA-01/02/08.
3. **Live `data_complete_through` per platform** (provider-reported, else `today − configured lag`) and conversion-maturity awareness in `compare_periods` — ends DA-03; and a **tri-state, oracle-requiring reconciliation** covering conversions/value, not just spend — ends DA-04/05.
4. **Ratio integrity**: emit a ratio only when numerator and denominator cover the same row/day set; extend `MISSING_METRIC` to impressions/clicks — ends DA-06/07.
5. **A deterministic data-sufficiency + confidence layer** implementing §5.2 as code, gating `propose_change` (evidence citation, sample floor, non-empty plans) and the audit rules — ends DA-10/11/18/19.
6. **Currency-safe money handling end to end**: per-currency minor-unit offsets (2/0/3-decimal), caps in major units per account, validated engine↔bridge unit contract, and dashboard tiles that reuse `summarizeReport`'s currency grouping and request `conversion_value` — ends DA-12/13/15/16/17.
7. **Per-tenant synthetic isolation** with a `synthetic:true` row marker and a write/apply assertion that synthetic providers cannot run under a non-demo org — ends DA-14.
8. **Store-verified revenue (T5)**: read-only Salla/Zid/Shopify order ingest, margin profiles, MER/CAC/payback compute beside `compute.py`, and the trust-tier promotion rule of §4 — ends DA-22 and unlocks rules §5.2#6.
9. **Incrementality primitives** (geo holdout, lift read-out) surfaced beside attributed numbers, plus an offline eval that fails when attributed performance is labelled incremental — ends DA-21.

---

## 8. Confidence (0-1) and what was NOT verified

**Confidence: 0.86** that the consolidated findings and their severities are correct and
non-duplicative. All 15 lead spot-check groups reproduced the specialists' citations
exactly; the two headline data defects (reconciliation tautology, cross-platform
attribution blend) were each found independently by three agents via different methods,
which is the strongest agreement in the cluster.

NOT verified (would require prohibited live access or a running stack):
- Live Pipeboard MCP payload shape — whether it *could* carry `data_complete_through`/`totals`/`currency`/`attribution` that the host currently ignores. All live-vs-fixture conclusions are VERIFIED_CODE on the host side, INFERRED on the wire.
- Live-LLM behavior under thin/noisy data and whether it honors the prose confidence/incrementality guardrails at inference (scripted/offline path only exercised).
- Runtime behavior of the Next.js dashboard tiles against live/sandbox providers (static call chain; DA-12 argued statically).
- Real provider minor-unit behavior for zero/3-decimal currencies (DA-15 from Meta docs + code).
- Whether X Ads/OpenAI Ads direct adapters and `MARKTING_DEMO_MODE` are reachable in a shipped production configuration or gated by settings (affects the production blast radius of DA-03, DA-14).
