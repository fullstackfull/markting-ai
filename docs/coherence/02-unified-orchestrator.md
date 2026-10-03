# 02 — Unified Intelligence Orchestrator — DONE

The keystone. `lib/markting/orchestrator/` is one application-level composition service that invokes the
existing deterministic engines coherently and returns one `IntelligenceResult`. Fully deterministic; the
LLM (later) narrates the result, never computes or reorders it.

## Modules

- `context.ts` — `IntelligenceRequestContext`: server-derived identity (org/workspace/user/permissions),
  account/provider, period/comparison, timezone, reporting currency, locale, runtime mode, business
  context. Security identity is never taken from LLM text. Typed `IntelligenceIntent`s.
- `envelope.ts` — `IntelligenceResult`: the single result envelope — a `ComposedDiagnosis` (one bilingual
  headline + ranked `ContributingFactor`s + unresolved questions), a single `NextAction`
  (ATTENTION/INVESTIGATE/REVIEW/EXPERIMENT/MONITOR/NO_ACTION/INSUFFICIENT_EVIDENCE), the next best
  question, unified recommendations, a `TrustSummary`, explicit per-domain availability
  (CONTRIBUTED/NO_SIGNAL/NOT_CONNECTED/INSUFFICIENT_EVIDENCE/BLOCKED_EXTERNAL), and the answer source.
- `orchestrator.ts` — `MarketingIntelligenceOrchestrator.compose()`: extracts factors from media
  diagnoses, commerce diagnoses, and creative problem-signals; scores each deterministically
  (`scoreFactor` = severity·100 + materiality·50 + confidence·5); composes a bilingual headline for the
  profitability-decline intent; selects one next action; unifies recommendations from every domain;
  summarizes trust (weakest-capped); reports domain availability. `money.ts`, `trust.ts`,
  `recommendation.ts` as in doc 01.

## The cross-domain question is now answerable

"Why did profitability decline and what should I do?" composes media diagnostics + commerce truth +
creative health + history into one ranked diagnosis, a single next action, unified review-only
recommendations, and a next best question — the exact composition the reassessment proved impossible
before (it previously returned a scripted fixture). Verified by `test/orchestrator.test.ts` and the 12
golden cases in `test/orchestrator-golden-cases.test.ts`.

## Safety preserved

No orchestrator output carries an execution affordance: every recommendation is `requiresHumanApproval:
true`. The only provider-write path remains the Phase-0 governed preview/apply chain, unchanged.
