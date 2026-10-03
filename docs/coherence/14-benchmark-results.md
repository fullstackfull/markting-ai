# 14 — Media-Buyer Benchmark: Before vs After (honest)

Re-scored against `docs/reassessment/12-media-buyer-question-benchmark.md`. Scoring rule (unchanged):
**A** = reachable through a shipped surface; **P** = partial/indirect or agent-only; **N** = not
reachable. A question is NOT marked A merely because a backend function exists — it must be reachable
through the actual product/orchestrator.

## Result

| | Baseline | After this program |
|---|---|---|
| **ANSWERABLE_NOW** | 8 / 50 | **12 / 50** |
| PARTIALLY | 16 / 50 | 20 / 50 |
| NOT_ANSWERABLE | 26 / 50 | 18 / 50 |

**The 40/50 target was NOT reached.** This is stated plainly, not worked around.

## What moved, and why

The unified orchestrator + the Needs Attention workspace + the Recommendation Center + the
orchestrator-backed assistant make the **diagnosis → why → recommendation → next action** loop reachable
as a product path. Newly ANSWERABLE_NOW:
- **#8** "Why did CPA rise?" — composed diagnosis reachable in the Workspace.
- **#15** "Why is Meta ROAS different from store MER?" — commerce-vs-platform composes into the diagnosis.
- **#19** "Which creatives are fatiguing?" — creative signals surface as ranked factors + recommendations.
- **#48** "Ask the assistant 'why is performance down?'" — the chat assistant now answers via the
  unified orchestrator. (Independent panel review initially flagged this as inflated because the chat
  routed only to the external engine; it was then **fixed**: `runAssistantTurn` falls back to
  `askAssistantForPrincipal` → the orchestrator when the external engine is unreachable, which is the
  case in any no-engine/demo deployment. When a real engine is configured it is used instead. So #48 is
  genuinely reachable via the Assistant in the demo/no-engine deployment, consistent with the synthetic-
  data caveat below.)

Newly PARTIAL (reachable as a composed factor/recommendation, but no dedicated surface yet): **#9**
allocation, **#12** scale-safety, **#16** true profit/margin (COGS still UNKNOWN), **#17** prior-outcome
history, **#20** creative refresh/kill.

## The critical honesty caveat

Every newly-answerable **analytical** question is demonstrated on **DEMO / synthetic data** (the demo
gatherer), because no live provider/commerce credentials exist here — live data is `BLOCKED_EXTERNAL`.
The *product path* genuinely exists and is reachable; the *content* for a real account depends on live
connections. The reporting/governance questions (the original 8) are unchanged and work on real data
when providers are OAuth-connected.

## Why 40/50 was not reached

40/50 requires both (a) the remaining dedicated surfaces — account/campaign drill-down, standalone
creative/commerce/experiment/agency/executive pages, a pacing/anomaly/forecast surface — which are
Wave-4–7 UI work recorded as PARTIAL/NOT_STARTED, and (b) live data for the analytical questions, which
is `BLOCKED_EXTERNAL`. This program delivered the coherence spine that makes those surfaces thin to add
(they compose from the orchestrator) and moved the number from 8 to 12, but the full target is gated on
that remaining UI breadth and live credentials.

No question was marked A on the basis of a backend function alone; each A is reachable via a shipped
route (Overview, Reports, Workspace, Recommendations, Assistant, or governance).
