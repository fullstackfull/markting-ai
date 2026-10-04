# C12 — Live AI gateway

## Built (seam + contract), deterministic in practice

- **Gateway** `lib/markting/ai-gateway.ts` (`AiGateway.invoke`): model-role allowlist (`resolveModel`),
  provider allowlist, idempotency via a ledger, rolling-window quota (requests + `costMicros`), a
  timeout race, bounded retry, and usage recording. `DEMO_GATEWAY_CONFIG` uses a `scripted` provider —
  **no live model traffic**.
- **Narrator** `lib/markting/intelligence/narrate.ts` (`narrateBrief`): arranges already-computed
  structured facts into bilingual prose, **always** attaches `evidence: EvidenceRef[]`, and never
  introduces a number not present in the structured intelligence. It returns `local_fallback` — the
  deterministic path, not a live model.

## Output contract (real, enforced)

`lib/markting/orchestrator/envelope.ts` `IntelligenceResult` is the governed output contract and already
carries everything the mission requires AI output to include:

- **claims** — the diagnosis + factors, each with `confidence` (LOW/MEDIUM/HIGH) and `dataTrust`;
- **evidence** — `EvidenceRef[]` on every factor (no claim without a reference);
- **limitations** — `unresolved[]`;
- **confidence** — per factor + the `trust: TrustSummary`;
- **source / time-window** — `context.period` / `comparisonPeriod`, `generatedAt`,
  `answerSource: 'LIVE_MODEL' | 'LOCAL_FALLBACK' | 'DETERMINISTIC_ONLY'`.

What the AI MAY do (summarize / explain / compare / prioritize / narrate) is exactly what the narrator
does over existing evidence. What it MUST NOT do is structurally impossible here: it cannot invent a
metric (narrator only re-expresses structured facts), cannot bypass evidence (every factor carries
refs), cannot write (write path is Mode-A gated, Mode B HELD), and cannot bypass approval or the
kill-switch.

## BLOCKED_EXTERNAL

A live governed model narrator (`answerSource: 'LIVE_MODEL'`) requires model-provider credentials, which
do not exist here (`liveModelAvailable()` returns false). The gateway, quota, metering, and output
contract are built and tested; swapping the scripted provider for a live one is the remaining step and is
**BLOCKED_EXTERNAL** — current answers are `DETERMINISTIC_ONLY` / `LOCAL_FALLBACK`, never fabricated as
model output.

**Status:** gateway + narrator + output contract implemented; live model BLOCKED_EXTERNAL.
