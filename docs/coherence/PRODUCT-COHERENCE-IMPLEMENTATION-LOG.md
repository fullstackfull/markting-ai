# Product Coherence — Implementation Log

Chronological, with commit SHAs and CI evidence. Branch `claude/amazing-heisenberg-0unnak`.

| # | Commit | Wave / Program | What | Tests | CI |
|---|---|---|---|---|---|
| 1 | `31099cd` | Wave 0 / P0 | RLS fixup migration `20261012000000` for `markting_ai_usage` + `markting_business_context` + real-Postgres regression test | DB-gated | run 23 FAILED (test bug, not migration) |
| 2 | `0b79c35` | Wave 0 fix + Wave 1 / P1 | Fixed the RLS test (adport_backend has no DELETE → org cascade; `db()` camelCase); added the orchestrator (context/envelope/money/trust/recommendation/orchestrator) + 10 unit tests | orchestrator 10, DB RLS | **run 24 SUCCESS** (Program 0 green) |
| 3 | `6102580` | Wave 2 / P17 | Four data-science corrections (sample-size units, pacing guard, reconciliation sample-awareness, anomaly rolling baseline + anchored seasonality) + 12 tests | 131 (new+affected) | queued |
| 4 | `18b4d1d` | Wave 3 / P2,3,4,6 | Orchestrator-backed assistant service + honest answer-source + demo/empty gatherers + Needs Attention + Recommendation Center + nav/i18n | assistant-service 6; build green; non-DB suite 733 | run 25 in progress at log time |
| 5 | `167e810` | P23 | 12 cross-domain golden cases | golden 12 | (next run) |
| 6 | (this) | docs | `docs/coherence/*` + exit report | — | (final run) |

## Key decisions (safest evidence-based choices, documented)

- **Boundary consolidation, not big-bang rewrite.** Canonical money/trust/recommendation are enforced at
  the orchestrator boundary; the duplicate types are reused and left in place for a later Program-25
  deprecation after callers migrate. This honours "delete duplication only after callers migrate safely."
- **Preserve the governed bridge.** The existing chat → Python-engine budget-proposal bridge (the one
  working write-safety feature) was left intact; the orchestration path was added alongside it rather
  than replacing it in one step, to avoid destabilizing the governed write chain.
- **Honest demo vs empty data.** With no live credentials, surfaces use a clearly-SYNTHETIC demo gatherer
  (trust reads non-live) or an empty NOT_CONNECTED gatherer — never fabricated live data.
- **Reconciliation widening bounded to n<5.** Chosen so the correction fixes tiny-sample false-MATERIAL
  without changing the existing n≥5 eval expectations (no eval test rewritten to mask a behaviour change).
- **Scale refactors deferred.** The shipped surfaces do not run the heavy read/ingest paths, so no scale
  work was required to ship them safely; the scale program is gated to the live large-account gatherer.

## What was NOT done (recorded, not hidden)

Dedicated account/campaign drill-down, standalone creative/commerce/experiment/agency/executive pages,
IA redesign, design-system/data-viz primitives, mobile reflow, a11y CI, Playwright E2E, live-model eval
harness, provider contract/replay tests, scale refactors, and the remaining data-science P2s. See the
per-area docs and the exit report for the status of each.
