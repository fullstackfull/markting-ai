# Phase 2 — Implementation Log

Branch `claude/amazing-heisenberg-0unnak`, from Phase 1 exit `3e91494`. Writes remain disabled; the
AI is read-only in LIVE_READ_ONLY / LIVE_RECOMMENDATIONS; engine stays byte-identical.

- `00a1c60` CI fixes (pnpm v6 + engine all-extras) + decision-model/confidence/diagnostics (2A/2B/2C/2Q).
- `a372220` CI build-order + dependency security (next 16.3.8, fast-uri/sharp overrides) +
  pacing/scaling/trend/anomaly/forecast/targets/health (2D/2E/2F/2G/2H/2I/2J/2K).
- `88739c9` CI run-3 fixes (Next typegen, gitleaks test allowlist, expired-op DB fixture).
- `9898eb9` recommendation engine + risk/impact + cross-channel/cross-campaign/creative/audience +
  analyze orchestrator + opportunity-center/brief/explainability/notifications + persistence
  (migration + store) + evaluation/safety/injection/DB tests (2L–2Y); CI DB-auth env.
- `<service>` production caller (service.ts/0.3) + narrate + ask (2V).
- `<commerce>` commerce intelligence contract + integration-test Phase-0 assertion fix.
- Docs 01–10 + this log; provider matrix (09) from an independent read-capability audit.
- CI run through: each dispatched run surfaced real failures, fixed one by one (see 01); the DB lane
  now runs the tenant-isolation / authz / concurrency / replay / recommendation-store suites against
  real Postgres + Auth.

## Design invariants held
- AI cannot write in read-only/recommendations mode (registry gate, Phase 1B); recommendations carry a
  typed category/action only — no endpoint/path/body; acceptance never mutates provider state.
- Deterministic-first: code computes every signal/diagnosis/contribution/confidence/risk/impact; the
  LLM only narrates. Confidence/impact are never model-invented.
- Evidence or silence: INSUFFICIENT_EVIDENCE is reachable everywhere; both windows gated; synthetic
  never reads as live; comparability gated across period/campaign/channel.
- Tenant-scoped, forward-only migrations, DB-backed isolation tests.

## Honest gaps (see 01, 09, 11, exit)
- Live OAuth / real ad-data transport: BLOCKED_EXTERNAL (no credentials); proven against the typed
  boundary + synthetic data, UNVERIFIED_LIVE_TRANSPORT.
- No live model wired: the gateway narrates locally (free, labelled local_fallback); live
  narration-quality is a Gate-B follow-up.
- Provider read parity: audited + documented (09); small typed-read additions staged, not implemented.
- Commerce connectors: typed contract only; implementations are Phase 3/4.
