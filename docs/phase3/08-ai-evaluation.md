# 08 — AI Evaluation 3.0 (memory & outcome reasoning)

`test/phase3-eval.test.ts` — 20 deterministic scenarios over the memory/outcome engines, scored for
factual accuracy, provenance, temporal accuracy, uncertainty, **causal restraint**, tenant isolation,
memory trust, non-poisoning, and bilingual language quality.

| # | Scenario | Asserted behavior |
|---|---|---|
| 1 | Accepted rec, positive aligned outcome | POSITIVE + `OUTCOME_ALIGNED_WITH_RECOMMENDATION` (not caused) |
| 2 | Rejected recommendation | counted rejected, never negative/failure |
| 3 | Accepted but modified | conclusion flags human modification |
| 4 | Contaminated by another change | CONTAMINATED |
| 5 | Not enough post-action data | INSUFFICIENT_DATA |
| 6 | Human target changed after rec | CONTAMINATED (confound) |
| 7 | Stale memory | not active |
| 8 | Explicit preference vs derived | derived cannot override explicit |
| 9 | Malicious campaign name → memory | poisoning rejected (source not allowed) |
| 10 | Memory write without org id | rejected by schema (no accidental cross-tenant) |
| 11 | Historical vs current | labeled HISTORICAL_OBSERVATION, kept separate |
| 12 | Calibration, little history | INSUFFICIENT_HISTORY |
| 13 | Prior success, current insufficient | derived cannot relax an explicit gate |
| 14 | Timeline association | TEMPORAL_ASSOCIATION, "not a proven cause" |
| 15 | Rejected ≠ failed | narration never says "failed" |
| 16 | Executed, unknown provider result | outcome pending, not assumed |
| 17 | Window crosses attribution change | CONTAMINATED |
| 18 | Corrected/revoked preference | drops from active memory |
| 19 | Arabic memory reasoning | Arabic labels (`[حقيقة]`) |
| 20 | English memory reasoning | English labels (`[Fact]`) |

All 20 pass. Supporting: `phase3-memory-outcomes.test.ts` (19 unit) and `phase3-stores.database.test.ts`
(DB-gated tenant isolation + lifecycle + jobs, green in the CI DB lane).

Honest limit: this is a deterministic benchmark over the structured engines — it is not a live-LLM
memory-narration benchmark, because no live model is wired (the gateway narrates locally). Bilingual
quality is checked structurally (labels + both languages present), not by grading free-form prose.
