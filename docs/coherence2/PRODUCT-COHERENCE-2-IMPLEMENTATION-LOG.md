# Product Coherence-2 — Implementation Log

Branch `claude/amazing-heisenberg-0unnak`. Builds on Coherence-1 (HEAD `3b04794`).

| Commit | What | Tests | CI |
|---|---|---|---|
| `22fd208` | Workstream A: rich synthetic seed, analytical sections over the REAL engines (pacing/anomaly/forecast/trend/response/scaling/scenario/creative/commerce/outcomes/memory/experiments/data-quality/portfolio/breakdown/cross-channel), 18 intents, rewritten deterministic router, executable 50-question benchmark | benchmark + sections; non-DB 747 | pending |
| `e999703` | Workstream B: persona surfaces (creative, commerce, experiments, agency, executive, data-quality, account drill-down) + reusable SectionView/IntelMeta + nav/i18n | build: all routes present; non-DB 747 | pending |
| `5203a68` | Workstream C: AI eval harness (modes + rubric) + 20 cross-domain scenarios + scale micro-benchmark | ai-eval-harness, scale; non-DB 752 | pending |
| (this) | coherence2 docs + exit report + gates | — | final |

## Key decisions (safest evidence-based, documented)

- **Real engines over a synthetic seed, not hard-coded answers.** Every assistant answer is a genuine
  computation (analyzePacing, detectAnomalies, forecastCumulative, classifyTrend, fitResponseCurve,
  evaluateScalingReadiness, allocateExtra, computeMER/computeMargin/reconcile, analyzeBreakdown,
  compareChannels). Demo figures are passed to the engines as if platform-reported so the computation
  runs; every surface marks the deployment DEMO and the composed trust reads SYNTHETIC/non-live.
- **Router, not keyword hacks.** 18 ordered deterministic rules map each question class to a real
  computation; the flagship "why did profitability decline" composes a cross-domain diagnosis (placed
  before the COMMERCE_PROFIT metric request so it is not stolen).
- **Honest not-now.** 7 benchmark questions stay agent-only (raw provider reads/writes) and 1
  unsupported; they were NOT forced to "answerable" by fabricating a capability.
- **Restored, never clobbered.** The pre-existing `ai-eval.test.ts` was restored verbatim after an
  accidental overwrite; the new harness lives at `ai-eval-harness.test.ts`.

## Not done (recorded, not hidden)

Dedicated campaign route, per-creative detail page + creative-intelligence dashboards, agency client
switcher in the shell, chart/data-viz primitives + formal component kit, Playwright E2E journeys,
provider contract/replay cassettes, remaining data-science P2s, DB-path scale refactors, remaining
security hardening slices, architectural physical dedup. See the per-area docs and the exit report.
