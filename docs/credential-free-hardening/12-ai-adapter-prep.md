# 12 — AI provider adapter + output validator + failover + creative pipeline (items 31, 32, 33, 34, 35)

Files: `lib/markting/ops/ai-provider-adapter.ts`, `lib/markting/ops/ai-output-validator.ts`,
`lib/markting/ops/ai-failover.ts`, `lib/markting/ops/creative-pipeline-prep.ts` + tests.

## AI provider adapter (item 31)

An `AIProviderAdapter` port **under** the existing governed `AiGateway`, mapping a read/analysis-only
`AICompletionRequest` (role + resolved `ModelDescriptor` + input — deliberately **no action/write verb
field**) to a normalized `AINormalizedCompletion`.

- `FakeAIProviderAdapter` — deterministic echo/canned output, recorded free (`tokensAvailable:false`,
  `localFallback:true`).
- `BlockedExternalAIProviderAdapter` — implements the port, ships no SDK/HTTP, throws a `BLOCKED_EXTERNAL`
  marker if called.
- DOCUMENTATION_DERIVED per-provider descriptors (model id per role, context window, price per 1k micros).

The read/analysis-only invariant is preserved: no write path is reachable from the adapter.

## AI output validator (item 32)

`validateAIOutput(raw, spec)` → `{valid, violations[], safeOutput?}`. `safeOutput` is populated **only** on
zero violations (invalid output is quarantined, never passed through). Checks: JSON parse/shape,
required-field, type, enum, numeric-range sanity, empty/refusal detection, prompt-injection-echo,
instruction-leak, and a secret-leak scan (text regexes + `redactLog`-semantics key scan).

## AI failover (item 33)

`runAIFailover` is a deterministic ordered failover across a role's allowlisted providers. Classification
mirrors the executor's `ErrorClass` (TRANSIENT → next, RATE_LIMIT → backoff + next, AUTH/PERMANENT → stop).
A per-provider **circuit breaker** (`closed`/`half_open`/`open`, aligned with the health breaker vocabulary)
trips on a threshold, trials after cooldown, and re-opens on a half-open failure. BLOCKED_EXTERNAL
candidates are skipped without tripping their breaker. Exhaustion → `DEGRADED_LOCAL_FALLBACK` or `STOPPED`
with no value — **never a fabricated success**. Pure over injected adapters + clock.

## Creative pipeline prep + model boundary (items 34, 35)

A pipeline shell with an explicit **model boundary**: `CREATIVE_PIPELINE_STAGES` marks
content-hash / dedup / policy-check / metadata-analysis as `LOCAL_DETERMINISTIC` and creative generation as
`REQUIRES_LIVE_MODEL`. The pipeline runs end-to-end on the local/metadata-only path (reusing the
multimodal-gateway fallback → `model:'none'`, `metadataOnly:true`); the live stage is BLOCKED_EXTERNAL and
never invoked (`BlockedCreativeModel.generate()` throws). `published` is always false — **no autonomous
publishing**.
