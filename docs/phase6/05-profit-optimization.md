# 05 — Profit-Aware Optimization (6R)

When merchant truth exists (Phase 5), allocation prioritizes business outcomes over platform ROAS:
contribution profit / margin, net revenue, blended CAC, MER, refund-adjusted performance.

`scalePriority` (allocation.ts) raises priority for a healthy contribution margin (≥ 20%) and penalizes
a negative contribution margin, so a high-platform-ROAS-but-thin-margin candidate ranks below a
profitable one. The profit-aware recommendation category is `PROFIT_OPTIMIZATION_REVIEW`. Where merchant
truth is absent, the system does not fabricate profit — it falls back to platform signals with reduced
confidence and says so.

Guardrails include `CONTRIBUTION_MARGIN_FLOOR` and `REFUND_RATE_CEILING`, so an option that would breach
margin/refund limits is flagged rather than recommended.
