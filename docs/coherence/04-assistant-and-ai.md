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

## Status of the live chat — PARTIAL

The existing chat (`lib/markting/assistant.ts` → Python engine) still handles the governed
budget-proposal bridge (the one working write-safety feature) and is preserved unchanged. The new
orchestration path is reachable via the Workspace and Recommendation Center surfaces and the service API.
Swapping the chat's analytical answers to call `AssistantIntelligenceService` directly (replacing the
scripted demo engine as the production brain) is the remaining step; it was kept separate here to avoid
destabilizing the governed bridge.

## Live model — BLOCKED_EXTERNAL

No governed model credentials exist in this environment. The gateway/role scaffolding and the
`ModelNarrator` seam are in place; wiring a real provider is a credential + config step. Until then the
product answers `DETERMINISTIC_ONLY` — honestly labelled, genuinely useful (the deterministic analytics
are the substance; the model only narrates).
