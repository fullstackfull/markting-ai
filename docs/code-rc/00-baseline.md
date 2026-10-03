# 00 — CODE-RC closure baseline

**Program:** CODE-RC CLOSURE & VERIFICATION — close the remaining code-solvable verification/engineering
gaps before any live integration. **Branch:** `claude/amazing-heisenberg-0unnak`.

## Starting point (from the hardening program)
CODE-RC reached: coherent product; campaign/creative/agency/charts READY; AI-eval 50/50; media-buyer
benchmark 42/50 (honest, classified); no open P0; Mode B HELD; autonomous optimization DISABLED. The
hardening exit left five PARTIAL gates: authenticated browser E2E, DB-path scale, accessibility CI,
dedicated security scanning, and live provider cassettes.

## Scope of this program
Close the code-solvable gaps (NOT new product intelligence, NOT new provider-write capability):
authenticated+authz browser E2E on a seeded session, DB query-path fixes + evidence, automated
accessibility CI, a dedicated security scanning lane, stronger fixture/live-source isolation, no hidden
demo path, and an explicit list of only the external/live blockers that remain.

## Constraints honoured
- No new product intelligence; no new provider-write capability; Mode B HELD; autonomous OFF.
- Honest verification: the dev container has no Docker/Supabase, so DB + authenticated-browser work is
  verified in CI (the `cloud-db` and new `e2e` lanes on a real Postgres/Supabase), not faked locally.
  Everything locally verifiable (unit/typecheck/package tests, the public browser project, the route
  gating) was verified before push; anything only CI can prove is reported by its CI result.

## Waves (CI-green increments)
- **V1** — source-isolation guard, truncation exposure, migration-RLS security check, const-time/CSRF/
  delete-grant/demo-path review.
- **V2** — TikTok replay + fuzz, benchmark regression gate, capability→route→section→tests map,
  degraded-state tests, observability hooks.
- **V3** — commerce N+1 fix, context-budget validation, query budgets, scale fixtures, perf harness.
- **V4/V5** — authenticated + authz browser E2E (test-only session bootstrap + seeded tenants) and
  automated axe accessibility, both on a new CI `e2e` lane.
- **V6** — manifest, independent audit, these docs, final report.

See the per-area docs (01–08), the manifest, and the exit report.
