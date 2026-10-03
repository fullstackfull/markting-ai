# Phase 1 — Baseline

Branch `claude/amazing-heisenberg-0unnak`, starting HEAD `e6fbd0c` (Phase 0 complete). Goal: move from
a fixture-only AI demo to real tenant-scoped marketing intelligence that the AI can read and analyze
**with writes still disabled** (Gate A read-only, Gate B analysis-no-writes).

## Hard constraints carried from Phase 0
- `engine/` is vendored byte-identical to import `4162146` and the CI drift check enforces it. Any
  Phase-1 engine-side behavior (tenant context, read-only tool policy, model gateway) therefore lives
  in the markting host (`services/engine-demo/serve_demo.py`) and the cloud, NOT in `engine/`.
- All Phase-0 write-safety holds: single write path, atomic/idempotent apply, four-eyes, generic-tool
  gate, currency integrity, live-write disabled by default. Phase 1 must not weaken any of it.
- The AI may read/analyze/recommend/produce hypothetical proposals; it must NOT perform provider
  writes. Enforced in tool registration, not prompt prose.

## What is implementable and verifiable in this sandbox
- Canonical marketing data model + normalization from provider `ReportRow` to `MetricObservation`
  with trust/attribution/currency/timezone metadata (pure TS, unit-tested).
- Deterministic media-buyer analysis engine (period compare, funnel, pacing, anomaly thresholds,
  campaign contribution) over canonical observations (pure TS, unit-tested).
- Data-trust wiring + INSUFFICIENT_EVIDENCE gates (deterministic, unit-tested).
- Selective AI context builder with budgeting (pure TS, unit-tested).
- Tenant engine context (structured, server-supplied) + READ_ONLY capability enforcement in the host.
- Model-gateway abstraction + usage/cost ledger (migration + cloud module, unit-tested at the
  boundary; token counts populated when the model layer reports them).
- Tenant marketing/business context model (KNOWN/CONFIGURED/DERIVED/UNKNOWN) + migration.
- Thread history listing + per-thread serialization.
- Evaluation suite over fixed synthetic datasets scoring the deterministic analysis engine on the 10
  media-buyer questions, including INSUFFICIENT_EVIDENCE and tenant-isolation safety.
- Provider read-capability matrix (audited) + the highest-value small missing reads where feasible.

## What is EXTERNALLY BLOCKED in this sandbox (cannot be proven here; runbooks provided)
- GitHub Actions CI first-green run (no runner here) — the root workflow exists; its DB-gated lane
  must be confirmed on GitHub.
- DB-backed test execution (Docker/Supabase are down here) — suites run in CI.
- Next.js patch bump (needs registry/network + a full build+e2e the sandbox cannot run) — recorded as
  a deploy-pipeline step with evidence.
- Live provider OAuth (real Meta/Google/… accounts) and a real Supabase project — cannot connect a
  real ad account from here; the live read path is built and unit-tested against a typed read
  interface + synthetic fixtures, and the real connection is a deploy/runbook step.
- KMS/TLS/backups and real model-provider traffic — deploy-pipeline/runbook; demo model is scripted.

These are marked BLOCKED-by-sandbox in the exit report, never as passing.

## Approach
Build the intelligence core (model → analysis → context → evidence → eval) and the governance layer
(tenant context, read-only enforcement, gateway, metering, threads) as cloud/host modules with unit
tests, preserving the engine byte-identical. Document the live-data architecture and the provider
matrix. Run an independent red-team. Classify Gate A/B honestly: expected PARTIAL where the only gap
is an external connection/infra step that is built-and-tested against a typed boundary but not
exercised against a real provider/DB here.
