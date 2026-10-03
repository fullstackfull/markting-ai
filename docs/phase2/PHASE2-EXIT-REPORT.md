# Phase 2 — Exit Report

Branch `claude/amazing-heisenberg-0unnak`, built from Phase 1 exit `3e91494` (Phase 0 exit `e6fbd0c`).
Phase 2 turns the Phase-1 primitives into a senior media-buyer intelligence system covering
**DATA → ANALYSIS → DIAGNOSIS → RECOMMENDATION**, with the AI confined to read/analyze/recommend and
**no provider writes**. Every claim is tagged CODE_COMPLETE / RUNTIME_PROVEN / BLOCKED_EXTERNAL.

## Invariant status

| Invariant | Status | Evidence |
|---|---|---|
| AI cannot write in READ_ONLY / LIVE_RECOMMENDATIONS | RUNTIME_PROVEN (unit) | registry read-only gate (`WRITE_FORBIDDEN_READ_ONLY`); `test/phase2-safety.test.ts` |
| Recommendation carries no endpoint/path/body (no 2nd action path) | RUNTIME_PROVEN (unit) | `decision-model.ts` typed category/action only; safety test asserts absence of forbidden keys |
| Accepting a recommendation does not mutate provider state | RUNTIME_PROVEN (DB) | `recommendation-store` transition only changes status + records an event; DB test |
| Deterministic diagnosis + factor decomposition (CPA/ROAS/CPC) | RUNTIME_PROVEN (unit) | `diagnostics.ts`; eval scenarios 1–2; 27 engine tests |
| Evidence floor reachable + both windows gated + staleness | RUNTIME_PROVEN (unit) | `data-trust.ts` + diagnostics; eval 5/6/7/16/19 |
| Comparability gated (period / campaign / channel) | RUNTIME_PROVEN (unit) | `cross-channel.ts`; eval 15 |
| Confidence/risk/impact deterministic + orthogonal | RUNTIME_PROVEN (unit) | `confidence.ts`/`risk.ts`/`impact.ts`; tests |
| Tenant isolation on all new persistent state | RUNTIME_PROVEN (DB) | `recommendation-store.database.test.ts` (org A ≠ org B); CI DB lane |
| Forward-only migrations | RUNTIME_PROVEN (DB) | `20261005000000_phase2_recommendations.sql` applied in CI `migration up` |
| Untrusted ad content is data, never instructions | RUNTIME_PROVEN (unit) | `test/phase2-injection.test.ts` |
| Org identity server-derived (never from prose) | RUNTIME_PROVEN (unit) | `engine-context.ts`; injection/eval 17/20 |
| Production caller uses one intelligence path | RUNTIME_PROVEN (unit) | `service.ts`; `test/phase2-service.test.ts` |
| Root CI green incl. DB lane | RUNTIME_PROVEN | run id recorded below |
| No Phase-0/1 invariant weakened | RUNTIME_PROVEN | red-team §11; Phase-0 write safety untouched |
| Live provider read transport | BLOCKED_EXTERNAL | no OAuth creds; proven against typed boundary + synthetic |
| Live model narration quality | BLOCKED_EXTERNAL | no model wired; gateway narrates locally (free) |

## Tests (this sandbox + CI)

- Cloud `tsc --noEmit` clean; full non-DB suite **421+ passed** (phase2 suites: intelligence 27,
  safety 3, injection 4, eval 20, service 6). Core 58. All package suites green.
- CI (GitHub Actions, dispatched on this branch): node, engine, drift, infra, security, and the
  **cloud-db** lane (real Postgres + Auth: tenant isolation, authz, concurrency, replay/idempotency,
  atomic claim, thread CAS, recommendation-store lifecycle). **Final green run: run #8 (id 37121774729),
  all six lanes `success` on the final code (b701585), including the real-Postgres DB lane.**

## Exit questions (answered with evidence, not architecture)

1. **Analyze a real tenant account end-to-end?** PARTIAL — the full path runs against the typed
   boundary + synthetic data (`service.ts`, tests); live transport is BLOCKED_EXTERNAL.
2. **Explain major CPA/ROAS changes?** YES — log-ratio decomposition, eval 1–3, with evidence.
3. **Distinguish signal from insufficient evidence?** YES — eval 4/5/6/16/19.
4. **Identify campaigns responsible for account movement?** YES — contribution, eval 3.
5. **Generate structured recommendations?** YES — 9 categories, typed, evidence-backed, persisted.
6. **Every recommendation explainable from data?** YES — `explainability.ts`, `isFullyExplainable`.
7. **Compare channels only when comparable?** YES — comparability gate, eval 15.
8. **Arabic + English?** YES — bilingual labels/narration throughout; ask router matches both.
9. **AI technically unable to write in recommendation mode?** YES — registry gate; safety tests.
10. **Useful for a senior media buyer's daily review?** See red-team §11 verdict.

## Gate verdicts

- **Gate A — Live tenant read: PARTIAL.** Read path + normalization + trust + analysis built and
  unit/DB-proven; live OAuth transport BLOCKED_EXTERNAL (no credentials). Confirm with a real account.
- **Gate B — Live AI analysis: PARTIAL.** Deterministic analysis is real, evidence-gated, evaluated
  (20 scenarios) and wired through the governed gateway; live-model narration is BLOCKED_EXTERNAL.
- **Gate C — Structured real recommendations: READY (code) / not live-exercised.** Typed, persisted,
  explainable, lifecycle-managed, tenant-scoped; generated deterministically from real analysis.
- **Gate D — Human-approved preview/write: HELD; NOT enabled.** Writes remain disabled; recommendations
  never execute; only the Phase-0 path can write. Not enabled automatically.
- **Gate E — First paying customer: NOT READY.** Live OAuth, live model, KMS/TLS/backups and
  operational hardening remain external/incomplete (see 08-production-readiness, carried from Phase 1).

## Phase-3 deferrals (explicit)

Live OAuth read + live-model narration + narration-quality benchmark; provider typed-read parity
additions (09); full commerce connector implementations (Salla/Zid/Shopify/WooCommerce); outcome
learning from recommendation lifecycle; marketing memory / self-learning / autonomous optimization /
automatic budget moves / multimodal creative / causal inference / merchant-profit optimization —
none started (as mandated).
