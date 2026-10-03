# 04 — Browser E2E foundation (Programs 12–13)

Delivered in H2 (`5dff354`). Real headless Chromium via `@playwright/test` — **not** unit-render.

## Harness
- `playwright.config.ts` — drives the built app in the pre-installed Chromium
  (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, launched via `PW_EXECUTABLE`).
- Because `output: standalone` is set, `next start` does **not** serve. The config boots the copied
  standalone server (`node .next/standalone/apps/cloud/server.js`, after `pnpm build:standalone`) with
  **non-secret placeholder env** — syntactically valid dummy values that satisfy `lib/env.ts` boot
  validation and connect to nothing. They are not credentials.
- `e2e/journeys.spec.ts` — the 10 required journeys E2E-01…E2E-10 (plus E2E-00 landing).
- vitest excludes `e2e/**` so the Playwright specs never run under the unit runner (this was the CI
  fix in `807fb3f`).

## What runs vs. skips — honestly
- **Public journeys run live and pass**: E2E-00 (landing renders) and E2E-10 (an authed route redirects
  to sign-in without a session) — 2 passed against the real standalone server.
- **Authenticated dashboard journeys (E2E-01…E2E-09)** are authored and **collected** (the harness
  exists; `--list` shows all specs) but **skip with an explicit reason** — they need a seeded Supabase
  auth session + a DEMO-mode server, which is unavailable in a credential-less container. They are
  guarded by `E2E_SEEDED_SESSION=1` so they never pass vacuously.

## Gate E verdict: **PARTIAL**
Real browser E2E exists and the public journeys pass live; the authed journeys require a seeded session
to execute. This is the honest ceiling without credentials, and the blocker is documented rather than
papered over with unit-render tests counted as E2E.
