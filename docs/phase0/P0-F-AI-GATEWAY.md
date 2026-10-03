# P0-F Exit — AI Gateway foundation & usage/cost metering

Status: the structural invariant (no direct browser→model path) **HOLDS today**; a full governed
gateway and token-level metering are **designed and deferred to Phase 1** with the reasons below.
No second action path was created.

## The invariant that already holds
Browser → MARKTING backend (Next.js) → engine host → model provider. The browser never calls a model
provider: the assistant route posts to the cloud, which calls the engine over a server-only token
(`MARKTING_ENGINE_TOKEN`, never shipped to the browser); the engine holds the model key. In demo mode
the "model" is a scripted offline component (no egress). Verified: no model SDK or provider key is
imported in any client component; the engine is reached only server-side (`lib/markting/*`).

## Gateway decision: thin native wrapper now, evaluate LiteLLM at live multi-tenant
We do NOT adopt LiteLLM in Phase 0. Reasons: (1) no live model traffic flows yet (demo is scripted,
and `assert_fail_closed` pins the engine to sample data); (2) the engine already centralizes model
construction (`assembly.resolve_model`) with timeout and retry middleware; (3) introducing a gateway
service now would add an always-on dependency and a second place that talks to providers, violating
"do not let the AI Gateway become an alternate action path." The decision: keep a **single** model
egress inside the engine assembly; when live multi-tenant model traffic is enabled (Phase 3 AI work),
introduce a governed gateway (self-hosted, in front of the engine's model client) providing: model
allowlist, provider-key isolation, per-org attribution, request_id, deadline, max-token caps, usage
capture, latency capture, retry policy, circuit breaker, provider fallback, cost metadata, redaction
hooks, audit correlation. Evaluate LiteLLM vs a native wrapper against the engine's existing
middleware at that point; do not adopt by popularity.

## Usage / cost metering — honest current state
Today the only limit is request-count rate limiting (`enforceRateLimit`, 120/min per key/org); there
is **no token-level metering**. The engine captures no `usage_metadata` (grep confirms none), and in
demo mode there is no model cost at all (scripted/local text is free). We do NOT pretend token
accuracy exists. Phase 1 design: a per-org usage ledger in adport Postgres keyed by
(org, user, action, model, request_id) storing captured token usage where the provider exposes it and
an estimated cost stored separately from actual provider-invoice truth, so one logical action is
charged once and retries (which reuse the pending/claim idempotency) do not double-charge. Local
fallback text is recorded as zero cost.

## Deferred
The gateway service, token metering ledger, and cost reconciliation — all Phase 1+, gated behind the
first live model traffic. None are required for Phase 0 (demo/fixture, writes off).
