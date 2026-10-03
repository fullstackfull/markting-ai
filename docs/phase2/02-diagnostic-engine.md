# 02 — Diagnostic Engine (2B / 2C)

`lib/markting/intelligence/diagnostics.ts`. Deterministic: **code detects and decomposes the signal;
the LLM only explains it.** Currency-safe, evidence-gated, bilingual, with machine-readable evidence
on every diagnosis (Phase 2W). One routine (`diagnoseEntity`) serves account and campaign scopes.

## Diagnoses emitted (DiagnosisType)

Spend: `SPEND_INCREASE`, `SPEND_DECREASE`, `UNDERDELIVERY`, `OVERSPEND_VS_PACING`.
Conversions: `CONVERSION_VOLUME_DECLINE/INCREASE`, `CONVERSION_RATE_DECLINE`.
Efficiency: `CPA_DETERIORATION/IMPROVEMENT`, `ROAS_DETERIORATION/IMPROVEMENT`, `CTR_DETERIORATION/IMPROVEMENT`, `CPM_PRESSURE`, `CPC_PRESSURE`, `FREQUENCY_PRESSURE`.
Funnel/quality: `FUNNEL_STAGE_COLLAPSE`, `DATA_QUALITY_ISSUE`, `TARGET_MISS/BEAT`, `ANOMALY`, `INSUFFICIENT_EVIDENCE`.

## Factor decomposition (2C) — arithmetic, not a guess

Multiplicative identities decomposed in log space so a movement attributes to its drivers; the share
is each factor's `|Δln|` over the total `Σ|Δln|` (a decomposition, never a causal claim):

- **CPA** = CPM / CTR / CVR → `Δln CPA = Δln CPM − Δln CTR − Δln CVR`. "CPA rose, 100% driven by CTR"
  is produced only when CTR is the dominant term.
- **ROAS** = conversions · AOV / spend → `Δln ROAS = Δln conversions + Δln AOV − Δln spend`. Drivers:
  conversion volume, value-per-conversion, spend.
- **CPC** = CPM / CTR → separates media-cost pressure from engagement, exactly as the mandate asks.

Decomposition is only produced when every factor is defined (all sides positive); otherwise it is
omitted rather than approximated.

## Evidence gating

Before any ratio-based diagnosis (CPA/ROAS/CTR/CVR/CPM/CPC), the evidence floor runs on **both** the
current and previous windows (`evaluateEvidence`, Phase 1 + the Phase-1 red-team hardening): synthetic,
partial window, <30 conversions, unknown/mixed/cross-period currency, or stale data → the ratio
diagnoses are suppressed and a single `INSUFFICIENT_EVIDENCE` diagnosis is emitted with the reasons.
Absolute facts that do not need ratio confidence are still surfaced — most importantly spend-with-zero-
conversions, which is a `CRITICAL` `DATA_QUALITY_ISSUE` regardless of sample.

Frequency is only diagnosed when a business/provider ceiling is supplied — there is **no** universal
frequency threshold hard-coded.

## Confidence (2Q)

`confidence.ts#deriveConfidence` — categorical (LOW/MEDIUM/HIGH), derived from data trust, sample size,
window completeness, freshness, signal strength, attribution consistency, and target availability. The
**lowest** contributing factor caps the result, so HIGH means every factor supported it. The model
never invents a confidence value.

Tested in `test/phase2-intelligence.test.ts` and `test/phase2-eval.test.ts` (scenarios 1, 2, 5, 9, 16, 19).
