# 06 — Creative & Commerce Integration — PARTIAL

## What was integrated — DONE

The previously-siloed creative and commerce engines now **contribute to the unified diagnosis and the
one recommendation queue** through the orchestrator:

- Creative problem-signals (fatigue / underperformer / concentration) become `ContributingFactor`s in
  the composed diagnosis and `UnifiedRecommendation`s (domain CREATIVE) in the Recommendation Center,
  surfaced alongside the campaign they affect — the user does not navigate to a separate creative
  module to see a creative cause of a campaign problem (Program 7.1 intent, met at the composition
  layer).
- Commerce diagnoses (refunds erode net revenue, revenue-up/profit-down, platform-ROAS-exceeds-merchant,
  below-break-even, data gaps) become COMMERCE factors + recommendations, and commerce money is lifted
  to canonical `Money` at the boundary (exponent-safe). Multimodal conclusions stay UNKNOWN (no live
  multimodal model) — never fabricated.

Verified by the orchestrator tests and golden cases (fatigue+refunds composition, platform-vs-merchant).

## What remains — NOT_STARTED

Dedicated **Creative** surfaces (library/detail/health/fatigue watch/hook/angle/clusters/test ideas) and
dedicated **Commerce** surfaces (revenue/net/refunds/MER/CAC/margin/contribution/reconciliation), plus a
store-connection flow. The engines and the composition exist; the dedicated pages and a live store
connector are not built (store connection is `BLOCKED_EXTERNAL` without credentials). Creative/commerce
intelligence is therefore reachable **within the composed diagnosis and recommendations today**, but not
yet as standalone explorable surfaces.
