# Hardening implementation log

Chronological record of the FINAL PRODUCT HARDENING program on branch
`claude/amazing-heisenberg-0unnak` (start HEAD `19f911f`). Each entry is a CI-green increment.

| Commit | Wave | Programs | What |
|---|---|---|---|
| `695b547` | H1 | 1–7 | Campaign detail route, creative detail route, navigation, agency client switcher, portfolio/executive depth. |
| `e7d0882` | H2 | 8–11 | Accessible inline-SVG chart primitives (TimeSeries/Bar/Funnel/Pacing), chart integration, mobile-critical + a11y CSS. |
| `5dff354` | H2 | 12–13 | Real browser E2E foundation — `@playwright/test` + standalone-server webServer; 2 public journeys pass live, 8 authed journeys authored + skip-guarded. |
| `807fb3f` | H3 | 15, 16, 23 (+CI fix) | Google replay contract suite (P0 counterpart); provider schema-drift safety states in the Data Quality Center; canonical ratio-safety primitive. **CI fix:** exclude `e2e/**` from vitest (cause of the node+DB lane failure on `5dff354`). |
| `d1e1b42` | H3 | 24, 27 | AI-eval dataset 20→50 (50/50 pass rubric); benchmark stays 42/50 with every not-now question machine-classified. |
| `73f2728` | H3 | 21, 22, 31, 32 | Forecast honesty surfacing (method/window/horizon/band/limitations); design-system kit formalized + wired into IntelMeta; one non-overloaded status vocabulary (label, not color-alone). |

## Validation per increment
- Each increment: `pnpm typecheck` green, the relevant vitest suites green locally, then pushed and CI
  re-triggered (`ci.yml`, 6 lanes) and confirmed green before the next increment.
- Full non-DB cloud suite at the H3 midpoint: **760 passed / 82 skipped**; Google package 29 passed;
  AI-eval 50/50; benchmark 42/50.

## Honesty ledger (where a gate is PARTIAL, not GREEN)
- **Browser E2E (Gate E):** public journeys pass live; authed journeys require a seeded Supabase session.
- **Provider replay (Gate J):** contract/replay edges covered deterministically; **live-captured
  cassettes** still require real credentials.
- **Accessibility CI:** enforced by construction + component unit tests; no automated axe-core lane added.
- **Benchmark:** 42/50 — 45 not honestly reachable without a new intelligence phase, live providers, or
  held writes (all out of scope). The 8 not-now are classified, not hidden.

See `HARDENING-EXIT-REPORT.md` for the full gate table.
