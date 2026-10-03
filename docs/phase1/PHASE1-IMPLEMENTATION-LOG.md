# Phase 1 — Implementation Log

Branch `claude/amazing-heisenberg-0unnak`, from Phase 0 HEAD `e6fbd0c`. Writes remain disabled;
engine stays byte-identical (Phase-1 engine behavior lives in the host + cloud).

- baseline `7f4cd20`: scope + in-sandbox vs externally-blocked split.
- 1C/1F/1H/1L `68dd23a`: canonical model, normalization (trust-wired), deterministic analysis engine
  (compare/funnel/pacing/MAD-anomaly/contribution, currency-safe, evidence-gated, bilingual), context
  builder. 14 tests.
- 1A/1B `6438363`: read-only tool capability in core (WRITE_FORBIDDEN_READ_ONLY) + EngineContext
  (server-derived tenant identity) + createTenantRuntime read-only wiring. +1 core test.
- 1I/1J `2a73384`: governed AI gateway (allowlist/timeout/retry/quota/usage) + usage ledger
  (idempotent, cost separate from invoice) + migration. 6 tests.
- 1G + eval `a4cbe71`: business context with KNOWN/CONFIGURED/DERIVED/UNKNOWN provenance (+migration,
  4 tests); AI media-buyer evaluation suite (10 questions + 2 safety, 12 tests).
- 1N `3385a25`: per-thread turn serialization (+migration, DB-gated test); thread history pre-existed.
- Docs 01–08 + this log; red-team pass; exit report to follow.

## Honest gaps (see 01, 03, 08, exit)
- Live OAuth / real Supabase / GitHub CI / Next.js bump / KMS / TLS / backups: external-blocked in the
  sandbox; built-and-tested against typed boundaries + synthetic data, with runbooks.
- Engine LLM narration still fixture-pinned (byte-identical engine); the deterministic signals are
  real-data-capable today via adport's governed report path.
- Provider read-parity small fixes (meta/tiktok status, snapchat names) audited + prioritized, staged
  as Gate-A hardening, not implemented this phase.
