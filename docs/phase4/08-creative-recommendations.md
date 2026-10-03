# 08 — Creative Recommendations, Test Ideas, Memory, Surfaces (4R/4S/4T/4U/4V–4Z)

## Recommendations (4R) — `creative/recommendations.ts`

Review-only categories: `CREATIVE_REFRESH_REVIEW, CREATIVE_FATIGUE_REVIEW, HOOK_TEST_REVIEW,
ANGLE_TEST_REVIEW, FORMAT_TEST_REVIEW, CTA_TEST_REVIEW, CREATIVE_CONCENTRATION_REVIEW,
UNDERPERFORMER_REVIEW`. Like Phase 2, a `CreativeRecommendation` is a typed review label carrying
evidence, confidence, risk, trust, scope, comparability, expected-impact DIRECTION, and optional
historical context — and **no endpoint/path/body**. `requiresHumanApproval` is always true; nothing
publishes/replaces/pauses. Generated only on real signals (a WATCH fatigue state does not auto-recommend;
INSUFFICIENT_DATA never yields an underperformer review).

## Test ideas (4S)

`creativeTestIdea()` returns a `{ kind: 'HYPOTHESIS', hypothesis, controlIdea, treatmentIdea,
primaryMetric, guardrailMetrics, requiredEvidence, minObservationGuidance }`. Explicitly a hypothesis,
not a proven strategy, and **never launched**.

## Creative memory + outcome linkage (4T/4U)

`store.rememberCreativePattern()` reuses the Phase-3 memory service: a verified creative pattern is
stored as `historical_outcome` WITH sample size + provenance. A DERIVED pattern from a tiny sample is
REFUSED (`< MIN_SAMPLE_FOR_CONFIDENCE`), so "blue backgrounds always win" from n=3 can never become
memory. The recommendation → human action → new creative → observation → outcome linkage reuses the
Phase-3 decision-events + observation-jobs + outcome engine (no auto-generation/publishing).

## Surfaces (4V/4W/4X/4Y/4Z) — `creative/surfaces.ts`

- **Library (4V/4W):** All / New / Top Performers / Watch / Fatigue Signals / Underperformers, grouped
  by hook / angle / format / cluster, with provider/account/campaign/media/status/hook/angle/state
  filters. A creative "detail" is the row joined with its signals/classification/cluster.
- **Dashboard (4X):** overview + hook/angle/format breakdowns, **always with sample size** and a caveat
  that breakdowns are NOT a single global average across incompatible cohorts.
- **Ask (4Y):** `which tiring / best hooks / why deteriorated / carrying campaign / what to test /
  video-vs-image / review-first` — answers cite creative ids as evidence and carry a comparability
  caveat; video-vs-image is gated.
- **Morning brief (4Z):** materiality-prioritized creative lines (strong-fatigue first, bounded), not
  a flood.
