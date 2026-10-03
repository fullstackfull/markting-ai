# 09 — Evaluation 4.0

`test/phase4-eval.test.ts` — 25 creative scenarios (some merged in code), scored for numerical &
classification correctness, fatigue restraint, non-causal language, comparability, security,
provenance, uncertainty, and bilingual quality. All pass.

| # | Scenario | Asserted |
|---|---|---|
| 1 | Low-spend creative | never a loser → INSUFFICIENT_DATA |
| 2 | High freq + falling CTR + corroboration | FATIGUE/STRONG, "(not proven)" |
| 3 | Falling CTR, stable low freq | not auto-fatigue (≤ FATIGUE, never STRONG) |
| 4 | CPM rise | contribution MEDIA_COST_DRIVEN |
| 5 | Spend, zero conversions | INSUFFICIENT_DATA (not loser) |
| 6 | New creative | NEW/LEARNING + INSUFFICIENT_DATA |
| 7 | Different objective | NOT_COMPARABLE |
| 8/17 | Small-sample "winner" | INSUFFICIENT_DATA |
| 9 | Shared asset | LIKELY_VARIANT |
| 10 | Same media + text | EXACT_DUPLICATE |
| 11 | Similar copy, different media | RELATED (not duplicate) |
| 12 | Malicious copy | treated as DATA |
| 13/22 | No model / UGC | UNKNOWN (nothing fabricated) |
| 14 | Mixed currencies | ratios not blended |
| 15 | Different objectives | NOT_COMPARABLE |
| 16 | Different attribution | PARTIALLY_COMPARABLE |
| 18 | Refresh recovery | NO_SIGNAL |
| 19 | Historical vs current | current rating unchanged (separation) |
| 20 | Arabic copy | classified |
| 21 | English copy | scientific angle detected |
| 23 | Creative launch | TEMPORAL_ASSOCIATION |
| 24 | Campaign deterioration | MEDIA_COST_DRIVEN |
| 25 | Cross-tenant write | rejected before DB access |

Supporting: `phase4-creative.test.ts` (multimodal gateway size/duration guards + metadata-only
fallback + free usage; library/dashboard/ask/brief; review-only recommendations with no publish path;
injection defense) and `phase4-creative.database.test.ts` (DB-gated tenant isolation, versioned
insert-only analysis, creative-memory sample guard).

Honest limit: deterministic benchmark over the structured engines; no live multimodal model (visual/
video verdicts are UNKNOWN by design here), so visual-classification accuracy is not benchmarked — that
is a Gate-E follow-up once a model is wired.
