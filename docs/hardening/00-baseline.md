# 00 — Hardening baseline

**Program:** FINAL PRODUCT HARDENING & COMPLETENESS — finish the product before live integrations.
**Branch:** `claude/amazing-heisenberg-0unnak` · **Start HEAD:** `19f911f` (CI-green).

## What this program is (and is not)

This is a **completeness + hardening** pass over the existing intelligence estate, not a new
intelligence phase. The hard constraints, honoured throughout:

- Do **not** begin another intelligence phase.
- Do **not** deepen backend features without a user-facing workflow.
- Do **not** implement fake shallow intents just to hit the benchmark target.
- Do **not** enable Mode B (provider writes), and do **not** enable autonomous optimization.

The exit is a **RELEASE-CANDIDATE CODE GATE ("CODE-RC")** — the code is coherent, tested and honest,
not a production go-live (which needs live credentials, real provider cassettes, and a human sign-off).

## Baseline state at `19f911f`

- Monorepo: pnpm/turbo at `platform/`; cloud app `platform/apps/cloud`; providers `platform/packages/*`
  (meta, google/`@adport/provider-google`, …); vendored Python engine.
- Unified orchestrator (`apps/cloud/lib/markting/orchestrator/`) composes real engines (pacing, anomaly,
  forecast, trend, response-curve/saturation, scaling, allocation, commerce MER/margin/reconcile,
  breakdown, cross-channel) over a synthetic seed portfolio (3 clients).
- Assistant: deterministic bilingual (ar default/RTL) keyword router → orchestrator sections.
- Benchmark: executable 50-question media-buyer benchmark; **42/50 ANSWERABLE_NOW** at baseline.
- AI-eval harness: 20 cross-domain graded scenarios; live model BLOCKED_EXTERNAL.
- CI: 6 lanes (node typecheck/build/tests; cloud DB on real Postgres; engine; upstream drift; infra;
  security = dependency + secret scan). All green at `19f911f`.

## Persistent invariants (unchanged by this program)

- Autonomous optimization DISABLED; Mode B provider writes HELD; Phase-0 governed write chain unchanged.
- No fabrication of live provider/model/commerce data — all live integrations are BLOCKED_EXTERNAL.
- Honest benchmark reporting: a question counts ANSWERABLE_NOW only if a shipped surface answers it or
  the assistant `check` asserts a real computed section — never on the basis of a backend function alone.

See the per-area docs (01–12), the implementation log, and the exit report for detail and evidence.
