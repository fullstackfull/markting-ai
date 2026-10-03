# 04 — Change Timeline & Change-Point Context (3P / 3Q)

`timeline.ts`, `decision-store.ts` (timeline read/write), `markting_timeline_events`.

The timeline combines factual events for an account/campaign: recommendations, approvals, provider
writes, human changes, tracking incidents, promotions, performance shifts, outcomes, memory changes.
Recommendations/approvals/writes come from `markting_decision_events` + `audit_events`; the dedicated
`markting_timeline_events` table holds observed operational context (tracking incidents, promotions)
that has no other home. `assembleTimeline()` orders them oldest→newest.

**Change-point context (3Q)** — `changePointContext()` takes a performance shift (metric, time,
direction, scope) and finds the changes in the lookback window (default 7d) that precede it. When
relevant changes precede the shift it returns `TEMPORAL_ASSOCIATION`, with narration "a temporal
association, not a proven cause". It **never** emits causation. This powers "What changed before
performance dropped?" as factual temporal context, not a causal claim.
