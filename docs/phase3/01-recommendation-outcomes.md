# 01 — Recommendation Outcomes (3A / 3B / 3C / 3D / 3N)

## Lifecycle + linkage (3A) — `decision-store.ts`, `markting_decision_events`

Append-only decision events distinguish the full lifecycle: `CREATED, REVIEWED, DISMISSED, ACCEPTED,
PREVIEW_REQUESTED, PREVIEWED, APPROVED, REJECTED, EXECUTED, EXECUTION_FAILED, EXPIRED, OUTCOME_PENDING,
OUTCOME_MEASURED`. **Acceptance (ACCEPTED) and provider execution (EXECUTED) are distinct facts and
never merged.** Each event can carry an immutable linkage to the Phase-0 operation — `pending_operation_id`,
`preview_digest`, account, entity, actor, timestamps — so `traceRecommendation()` reconstructs
Recommendation → Preview → Approval → Apply → Provider result from facts, not text.

## Before/after snapshots (3B) — `outcomes.ts`, `outcome-store.ts`

`saveBaseline()` captures a structured BEFORE snapshot (entity scope, metrics, window, currency,
attribution basis, trust, timezone, targets, diagnosis, category) before execution. Observation
windows are **per category** (`recommendedWindows()`), never one universal window — tracking fixes
check at 24h/3d, budget/pause reviews at 3d/7d/14d; providers/conversion delay can extend them.

## Outcome engine (3C) — `evaluateOutcome()`

Deterministic classification: `POSITIVE / NEGATIVE / NEUTRAL / INCONCLUSIVE / INSUFFICIENT_DATA /
CONTAMINATED` — never forced into success/failure. Resolution order: **contamination → insufficient
data → classify**. Contamination is detected from external signals (another budget change, a separate
pause, a promotion, a tracking break, too short a window) AND structurally (a currency or attribution
change between the before/after windows). Every outcome carries method, before/after windows, the
primary metric + its beneficial direction, actual direction, contamination flags, trust, and a
bilingual conclusion.

**Causal restraint (in code and narration):** a post-change improvement is at most
`OUTCOME_ALIGNED_WITH_RECOMMENDATION`; the narration says "temporal alignment … not proven causation".
`CAUSAL_EXPERIMENT_SUPPORTED` is reserved for a real experiment (not produced in Phase 3).

## Human modification (3N)

When the human accepts the idea but changes parameters, the decision event and the outcome row carry
`modified = true`, and the conclusion states the parameters were human-modified — the outcome is **not**
attributed to the exact original recommendation.

## Effectiveness ledger (3D) — `learning.ts#buildEffectivenessLedger`

Per-dimension counts (overall / by category / provider / confidence / risk): made, accepted, rejected,
executed, outcomeMeasured, positiveAligned, negativeAligned, inconclusive, contaminated, plus rejection
reasons. **No global "AI accuracy" score** — the ledger note states alignment is temporal, read per
dimension with its sample size. A **rejected** recommendation is counted as rejected, never as a
failure/negative outcome.
