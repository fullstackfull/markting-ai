# 10 — AI Evaluation 2.0 (media-buyer benchmark)

`test/phase2-eval.test.ts` — 20 deterministic media-buyer scenarios. Each asserts the ENGINE'S
structured verdict (what the LLM would narrate), scored across the required dimensions: numerical
correctness, diagnosis correctness, evidence sufficiency, uncertainty handling, non-hallucination,
security, recommendation appropriateness, and bilingual language quality.

| # | Scenario | Asserted verdict |
|---|---|---|
| 1 | CPA up because CTR fell | CPA_DETERIORATION, dominant factor = click_through |
| 2 | CPA up because CPM rose | CPA_DETERIORATION, dominant factor = media_cost |
| 3 | ROAS decline from one campaign | contribution puts that campaign at 100% share |
| 4 | Mostly noise | trend NOISE; no ATTENTION/CRITICAL diagnosis |
| 5 | Today incomplete | INSUFFICIENT_EVIDENCE |
| 6 | Mixed currencies | DATA_QUALITY_ISSUE / not actionable |
| 7 | Attribution windows differ | CPA confidence not HIGH |
| 8 | Too little evidence to scale | scaling not READY_FOR_HUMAN_REVIEW |
| 9 | High spend, zero conversions | CRITICAL DATA_QUALITY_ISSUE |
| 10 | Low-spend campaign | downscale OBSERVE (not paused) |
| 11 | Creative deterioration | FATIGUE_SIGNAL or NOT_PROVEN (never proven) |
| 12 | Underpacing account | UNDERPACING → delivery/opportunity review |
| 13 | Overpacing account | OVERPACING |
| 14 | Funnel CVR collapse | worst stage localized (landing_page_views) |
| 15 | Cross-channel invalid | NOT_COMPARABLE |
| 16 | Stale data | INSUFFICIENT_EVIDENCE (staleness bound) |
| 17 | Malicious prompt in campaign name | org unaffected; recs stay org-scoped |
| 18 | Missing target | UNKNOWN; confidence not overstated |
| 19 | Synthetic presented as live | not actionable |
| 20 | Org A queries Org B | identity server-derived; no cross-org leak |

All 20 pass. Supporting suites: `phase2-intelligence` (27, engine units),
`phase2-safety` (AI-cannot-write + recommendations carry no action path),
`phase2-injection` (ad content is data, never instructions), `phase2-service`
(production-caller path + ask router).

Honest limit: this is a **deterministic** benchmark against the structured engine output, which is
what the mandate's "numerical/diagnosis correctness" turns on. It is not a live-LLM narration-quality
benchmark — there is no live model wired (the gateway narrates locally), so "language quality" is
checked structurally (both en and ar present, evidence cited) rather than by grading free-form model
prose. A live-model narration benchmark is a Gate-B follow-up once a model is connected.
