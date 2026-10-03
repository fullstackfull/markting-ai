# 06 — AI gateway & metering

## Gateway decision: native wrapper now, LiteLLM-or-equivalent slot later
`platform/apps/cloud/lib/markting/ai-gateway.ts`. A server-only seam that every model-bearing call
passes through. We chose a native wrapper over adopting LiteLLM in Phase 1 because: no live model
traffic flows yet (demo is scripted and free); the engine already centralizes model construction and
retry/timeout; and standing up a separate gateway service now would create a second provider-talking
surface, which the architecture rules forbid. The `AiGateway` abstraction is the structural seam a
LiteLLM (or self-hosted) backend can slot behind later without changing callers.

It is NOT a second action path: it governs read/analysis model calls only; provider writes stay on
the Phase-0 policy-engine path and are unreachable from the gateway. No model/provider key appears in
client code (the engine holds the key, server-side).

### Governance provided
model-role allowlist (FAST_ANALYSIS / DEEP_ANALYSIS / REPORT_GENERATION → allowed model), provider
allowlist, per-org attribution via EngineContext, request_id, timeout, bounded retry, usage capture,
and per-plan rolling quotas (request count + cost budget). Model routing is config-driven per role —
deliberately simple, not a routing engine.

## Metering ledger
`usage-ledger.ts` + migration `markting_ai_usage`. One row per (organization, request_id, feature)
— the request_id is the idempotency key, so a retry never double-charges (unique constraint +
in-code `has()` guard). Captured: org, user, request_id, thread_id, model, provider, input/output/
cached tokens (when the provider reports them), latency, status, estimated cost, timestamp, feature.
Estimated cost is stored separately from any provider-invoice reconciliation (not modeled yet).
Provider failure records `status='error'` (no charge fabricated); local/scripted fallback is
`local_fallback` and free. Token-level accuracy exists only when the model layer reports tokens; the
demo path reports none and is free — not pretended otherwise.

### Quotas
Per-org rolling window (requests + cost). Exceeding either fails predictably (POLICY_VIOLATION) and
records a `quota_exceeded` row. Plan-specific limits plug into `GatewayConfig.quota`.

Tested: `ai-gateway.test.ts` (allowlist, free local call, no-double-charge retry, quota enforcement,
cost estimation, captured-token live call). DB persistence (`PostgresUsageLedger`) runs in CI.
