# Phase C — Baseline (C0 entry state)

_Branch: `claude/amazing-heisenberg-0unnak`. Baseline at the start of the C0 pre-live closure._

## What exists at C0 entry

Phase A (flagship live-capable gatherer + range/freshness) and Phase B (professional
media-buyer depth: canonical hierarchy, drill-down surfaces, breakdown explorer, tenant RLS
backstop) are complete and were CI-green at commit `c394f38`. The product runs in two postures,
chosen by `resolveRuntimeMode()` (`lib/markting/runtime-mode.ts`):

- **DEMO** — a clearly-SYNTHETIC seed portfolio (`lib/markting/orchestrator/seed.ts`) composed
  through the real orchestrator. Every trust tier is `SYNTHETIC`; nothing is presented as live.
- **LIVE_*** — real tenant data read through the engine gatherer. With nothing connected the
  surfaces degrade to an honest `NOT_CONNECTED` empty state, never demo content. **No live
  provider credentials exist in this environment**, so live reads are `BLOCKED_EXTERNAL`.

## Posture and prohibitions carried into Phase C

- No autonomous optimization. No uncontrolled provider writes. Mode B (write control) stays HELD.
- The runtime-mode ladder has no `FULL_AUTONOMOUS_WRITE` member; apply is refused outside
  `DEMO` / `LIVE_WRITE_APPROVAL_ONLY` (`assertApplyAllowed`). Phase 0 ceiling unchanged.
- Live verification that cannot be performed without real credentials is marked
  `BLOCKED_EXTERNAL` and never fabricated.

## CI lanes (the C0 exit gate is 7/7 green)

`node` (unit, `ADPORT_RUN_DATABASE_TESTS=0`), `cloud-db` (real Postgres, DB tests on),
`e2e` (seeded Supabase, DEMO runtime, Playwright + axe), `security`, `engine`, `infra`, `drift`.

## Known issue resolved in C0

The Phase-B "deep-drill E2E divergence" (deep Account→Campaign→Group→Ad links appeared not to
render content under the seeded browser server) was an **unresolved mystery** at baseline and had
forced E2E-14 to be scoped down to route-reachability. C0.4 reproduces it against a local seeded
Supabase + standalone build and identifies the root cause (see `04` / `01`): this Next build does
not URL-decode dynamic route params, so composite colon-delimited ids built with
`encodeURIComponent` arrived percent-encoded and never matched the seed lookup.
