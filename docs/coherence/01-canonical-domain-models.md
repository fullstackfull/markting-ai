# 01 — Canonical Domain Models — DONE (boundary), PARTIAL (physical dedup)

The reassessment found 3 Money types, 4 trust vocabularies, and 4 recommendation pipelines. This
program consolidates them **at the orchestration boundary** (so nothing user-facing shows more than one
definition), reusing the strongest existing type each time, and defers physical deletion of the
duplicates to Program 25 (done only after callers migrate safely — no big-bang rewrite).

## Money — DONE (boundary)

Canonical: `@adport/core` `Money { currency, minor, exponent }` (integer minor units + explicit ISO
exponent; fail-closed on unknown currency). `lib/markting/orchestrator/money.ts` lifts commerce
`{minorUnits, currency}` to canonical `Money`, recovering the exponent from the ISO table — fixing the
`CommerceMoney` exponent-drop bug for every amount the orchestrator surfaces. Cross-currency comparison
returns `undefined` (never an invented FX blend). Tested: JPY (0-dec) and KWD (3-dec) round-trip, unknown
currency fails closed. **Remaining (Program 25):** migrate commerce internals off `CommerceMoney`.

## Trust — DONE (boundary)

Canonical: `DataTier`/`DataTrust` (`data-trust.ts`). `orchestrator/trust.ts` provides documented
adapters from the commerce order-provenance tiers (`CommerceTrustTier`) and memory tiers, a weakest-tier
capping rule (a cross-domain claim is only as trustworthy as its weakest input), and a `TrustSummary`
the UI renders as one chip. **Remaining:** migrate memory/commerce stores to emit canonical tiers
directly.

## Recommendation — DONE (boundary)

Canonical product type: `UnifiedRecommendation` (`orchestrator/recommendation.ts`), with lossless
adapters from all four domain pipelines (media `Recommendation`, `CreativeRecommendation`,
`CommerceRecommendation`, `OptimizationRecommendation`). Native evidence is preserved verbatim under
`evidenceDetail`; risk/confidence normalized; deterministic risk-then-confidence ranking. The native
generators are reused unchanged. **Remaining (Program 25):** retire the bespoke types once the
Recommendation Center and stores consume only `UnifiedRecommendation`.

**Tests:** `test/orchestrator.test.ts` (money/trust/recommendation consolidation).
