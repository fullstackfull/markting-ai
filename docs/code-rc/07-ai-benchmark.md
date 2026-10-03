# 07 — AI eval + media-buyer benchmark as CI gates (Programs 24–26)

## AI eval in CI (Program 24)
`test/ai-eval-harness.test.ts` runs the 50-scenario deterministic evaluation on every push (node lane,
via `pnpm test`). It asserts, per scenario: expected factors present, forbidden/hallucinated factors
absent, next-action within the allowed set, grounding (every factor carries a data-trust tier), trust =
weakest source, and write-prohibition (every recommendation `requiresHumanApproval`). **50/50 pass.**
Live-model grading stays separate and BLOCKED_EXTERNAL: a `LIVE_MODEL` run falls back to the
deterministic result and reports `answerSource === 'DETERMINISTIC_ONLY'`, so it can never masquerade.

## Benchmark regression gate (Program 25)
`test/benchmark.test.ts` is now a REGRESSION GATE: it fails CI if `ANSWERABLE_NOW` drops below the
current honest **42/50**, and it fails if any assistant question's `check` silently fails (an inflated
mapping). It was NOT pushed to 45 artificially — the 8 not-now questions keep their machine-checked
classification (`REQUIRES_PROVIDER_CAPABILITY ×4`, `INTENTIONALLY_UNSUPPORTED ×3`,
`NOT_SUPPORTED_BY_PRODUCT ×1`). Raising the floor requires a genuinely added capability.

## Route-capability map (Program 26)
`lib/markting/orchestrator/capability-map.ts` + `test/capability-map.test.ts` encode and CI-enforce the
mapping **capability → route → orchestrator section → tests**. The test asserts each capability resolves
to a real route file on disk, a real section kind (or `surface`), a valid intent, and named tests that
exist — so a capability can never silently regress into a backend-only function with no reachable
surface. The core daily-use capabilities (campaign, creative, commerce, assistant, agency) are required
to be present.

## Gate status
AI eval CI: GREEN (50/50). Benchmark CI gate: GREEN (42/50, regression-gated, honest). Route map:
GREEN (CI-enforced).
