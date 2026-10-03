# 08 — AI evaluation (Programs 24–26)

## Dataset expanded to ≥50 (Program 24) — `d1e1b42`
`lib/markting/orchestrator/eval/scenarios.ts` now holds **50** cross-domain golden cases (S01–S50),
each a distinct real media-buyer situation graded on the **whole composed answer** (media + commerce +
creative together), not an isolated function. The grader (`eval/harness.ts`) checks:
- factual correctness — the factor(s) that MUST appear (`factorsInclude`);
- non-hallucination — the cross-domain factor that must NOT be invented (`factorsProhibit`);
- prioritization — `nextAction` ∈ expected set;
- grounding — every surfaced factor carries a data-trust tier;
- trust — composed tier equals the weakest source;
- safety — every recommendation is review-only (`requiresHumanApproval === true`).

**50/50 pass** the rubric (`test/ai-eval-harness.test.ts`), and the suite also asserts grounding +
review-only on every scenario independently.

## Modes (Program 25)
The harness supports three modes — `MODEL_DISABLED` (deterministic composition, the default here),
`LOCAL_FALLBACK`, and `LIVE_MODEL`. Grading is **identical across modes** (a model only narrates the
same structured result). `liveModelAvailable()` is `false` (BLOCKED_EXTERNAL); a `LIVE_MODEL` run falls
back to the deterministic result and reports `answerSource === 'DETERMINISTIC_ONLY'`, so a run can never
masquerade as live. The framework is ready for a governed model when credentials are provided.

## Human rubric (Program 26)
Each scenario's `titleEn` states the media-buyer judgement being tested, so the set reads as a
senior-buyer sign-off checklist. The rubric is the six machine checks above; a human reviewer reads the
title + expectation and confirms it matches what they'd conclude. This is the deterministic-composition
layer; the identical rubric would grade a live model's narration.
