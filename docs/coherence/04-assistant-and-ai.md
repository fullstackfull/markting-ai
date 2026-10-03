# 04 — Assistant & AI — DONE (orchestration path + honest source), PARTIAL (chat swap), BLOCKED_EXTERNAL (live model)

## What was built — DONE

- `orchestrator/assistant-service.ts` — `AssistantIntelligenceService`: a deterministic bilingual
  question→intent router (`routeIntent`) + a pluggable `IntelligenceGatherer`; `ask()` and `run()`
  compose via the orchestrator and narrate. Security identity comes from the server context, never the
  question text.
- `orchestrator/answer.ts` — the real AI answer abstraction with an explicit, honest **source**:
  - `LIVE_MODEL` — a governed model narrated the deterministic result;
  - `LOCAL_FALLBACK` — a model was configured but unavailable, deterministic narration used;
  - `DETERMINISTIC_ONLY` — no model configured; the deterministic narration IS the answer.
  A fallback is never presented as a live model. Model roles and routing stay server-side; the narrator
  may re-phrase but may not introduce a number/claim absent from the structured evidence. Every material
  claim carries inspectable evidence (metric/period/trust) — no hidden chain-of-thought.
- `lib/cloud/intelligence.ts` — server bridge from the dashboard tenant to the service; picks the demo
  gatherer in DEMO and the empty (NOT_CONNECTED) gatherer otherwise.

Verified: `test/assistant-service.test.ts` — routing (en/ar), the cross-domain profitability answer with
`DETERMINISTIC_ONLY` source + evidence + unified recommendations, and the honest INSUFFICIENT_EVIDENCE /
"connect your providers" answer when nothing is wired.

## Status of the live chat — DONE for the no-engine case, PARTIAL for the engine-reachable case

`runAssistantTurn` (`lib/markting/assistant.ts`) now falls back to the orchestrator
(`askAssistantForPrincipal` → `AssistantIntelligenceService`) when the external engine is **unreachable**
— which is the case in any no-engine/demo deployment (including this environment). So "Ask AI" answers
via the unified orchestration path there, rather than erroring. The governed budget-proposal bridge is
untouched and still runs whenever the engine IS reachable, so no write-safety path is bypassed.

**Remaining (PARTIAL):** when a real narration engine is configured and reachable, the chat still uses
it for analytical answers; routing those through the orchestrator too (so the orchestrator is the brain
and the model only narrates, even with an engine present) is the next step. This was deliberately scoped
to the unreachable-engine fallback first to avoid destabilizing the governed bridge.

## Live model — BLOCKED_EXTERNAL

No governed model credentials exist in this environment. The gateway/role scaffolding and the
`ModelNarrator` seam are in place; wiring a real provider is a credential + config step. Until then the
product answers `DETERMINISTIC_ONLY` — honestly labelled, genuinely useful (the deterministic analytics
are the substance; the model only narrates).
