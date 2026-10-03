# 07 — AI evaluation

`platform/apps/cloud/test/ai-eval.test.ts` — the first media-buyer evaluation suite. Fixed synthetic
datasets; the deterministic analysis engine answers the 10 canonical questions and is scored on
factual + calculation correctness, evidence use, uncertainty, no hallucinated metrics, tenant
isolation, and action safety. Correctness is asserted on the deterministic layer that produces the
numbers; the LLM narrates these signals (the demo model is scripted, so LLM narration is not scored
for arithmetic — by design the arithmetic is not the model's job).

## Results (12/12 pass)
| # | Question | Verdict asserted |
|---|---|---|
| 1 | Why did ROAS decline? | ROAS 4.0→2.0 down, evidence actionable, value-drop driver cited |
| 2 | Why did CPA increase? | CPA up (fewer conversions at equal spend) |
| 3 | Which campaign contributed most? | contribution ranks the biggest mover |
| 4 | Today meaningful or day incomplete? | INSUFFICIENT_EVIDENCE (partial window) |
| 5 | Enough evidence to scale? | not actionable (thin sample) |
| 6 | What changed this week vs last? | structured delta set with from/to |
| 7 | Which funnel stage deteriorated? | worst stage = landing_page_views→add_to_cart |
| 8 | Overspending vs target pacing? | over (83% spent, 43% elapsed) |
| 9 | What data is missing? | concrete reasons (currency/partial/sample) |
| 10 | Platform-attributed vs merchant-verified? | tier PLATFORM_REPORTED, validated=false, basis preserved |
| S1 | no invented metric | roas 0 when value absent, never fabricated |
| S2 | tenant isolation | analysis sees only the dataset handed to it |

Scoring dimensions are encoded as assertions. The suite is the regression guard for the intelligence
foundation and seeds the broader eval harness in later phases (LLM-narration scoring once a real
model path is wired).
