# 04 — Fatigue Engine (4E)

`creative/fatigue.ts`.

Fatigue is **never** declared from one metric. `assessFatigue()` collects corroborating signals:
rising frequency, falling CTR, rising CPC, declining CVR, declining ROAS, CPM not falling (rules out an
auction-wide cheap-impression cause), and age. States:

`NO_SIGNAL / WATCH / FATIGUE_SIGNAL / STRONG_FATIGUE_SIGNAL / INSUFFICIENT_EVIDENCE`.

Methodology:
- **INSUFFICIENT_EVIDENCE first:** low tier, under the impression floor, open window, or a thin
  conversion sample (for ratio signals) → no fatigue read at all.
- **STRONG_FATIGUE_SIGNAL** requires the core pair (rising frequency + falling CTR) AND CPM not falling
  AND ≥1 efficiency corroboration (declining CVR/ROAS or rising CPC). Confidence HIGH needs ≥2.
- **FATIGUE_SIGNAL** requires the core pair or falling CTR + one corroboration.
- **WATCH** for a single early signal (falling CTR OR rising frequency alone).
- If CPM FELL, the CTR/CPC move may be auction-driven; the engine downgrades and says so.

It **never** outputs "PROVEN FATIGUE" — the labels explicitly read "(not proven)". Proven fatigue would
require an experiment, which Phase 4 does not run. Every result carries the contributing signals +
confidence as evidence.
