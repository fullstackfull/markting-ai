# 06 — Computed Flagship Diagnosis (A5)

**Problem:** the flagship "why did profitability decline / what changed" answer was hard-coded in the demo
gatherer (literal diagnoses + materiality).

**Fix:** in the LIVE path the answer is now **computed from canonical observations** by `analyzeAccount`
(period-over-period `diagnoseEntity`, contribution, anomaly, pacing, scaling, recommendations) — no
hard-coded response and no fixture branch anywhere in the live path. The orchestrator composes the
headline/next-action/trust from those computed factors. Each factual claim maps back to a machine-
reconstructable `EvidenceRef` on the diagnosis; causal restraint is inherited from the engine (before/after
is `TEMPORAL_ASSOCIATION`, never "X caused Y"; confidence is capped by the weakest factor; thin data →
`INSUFFICIENT_EVIDENCE`).

**Output structure** (per the engine + orchestrator): what changed (diagnosis summary), largest contributing
factors (ranked), evidence (EvidenceRef), data limitations (trust/limitations), what to inspect next
(sections / next-best-question), suggested action (review-only recommendations), confidence.

**Model policy:** deterministic. No live LLM is wired; the system runs with MODEL_DISABLED (the narrator is
the deterministic fallback). Proven end-to-end through the real pipeline on contract fixtures in
`test/live-value-loop.test.ts` (a CPA deterioration is diagnosed with evidence, PLATFORM_REPORTED trust). The
DEMO gatherer remains a clearly-SYNTHETIC demonstration, kept off live surfaces by the source guard.
