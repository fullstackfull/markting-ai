# 01 — Live & Execution Proof (Workstream 0)

## 0.1 CI / database proof — EXECUTED

The root CI (`.github/workflows/ci.yml`) was run for real on this branch via `workflow_dispatch`
(the user authorized running it). The first dispatched run surfaced real failures, each fixed and
re-run until the lanes went green. The DB lane boots a disposable Supabase stack, applies migrations
forward-only, and runs the gated suites against a real Postgres.

Fixes made to get CI green (all in the CI workflow / lockfile / tests, never by weakening a gate):

| Run | Failure | Fix |
|---|---|---|
| 1 | `pnpm/action-setup@v4` could not resolve pnpm at the monorepo root (no root package.json) | bump to `@v6` + `package_json_file: platform/package.json` (reads `packageManager`) |
| 1 | engine `mypy src` flagged untyped slack decorators | engine lane now runs `uv sync --frozen --all-extras --dev` first (mirrors engine's own CI; installs `slack-bolt`) |
| 2 | provider typecheck `Cannot find module @adport/core`; cloud test `Cannot resolve @adport/mcp` | build workspace packages BEFORE typecheck/tests in the node and cloud-db lanes (clean CI has no `dist/`) |
| 2 | `pnpm audit --audit-level high`: 3 critical + 6 high | bump `next` 16.3.1→16.3.8 (clears 3 Next.js RCE criticals — the Phase-1 deferred bump); `pnpm-workspace.yaml` overrides force `fast-uri ^3.1.7` and `sharp ≥0.35.4` (clears the transitive highs). Audit gate unchanged; 10 moderate remain (below the gate) |
| 3 | cloud typecheck fails on `RouteContext` (Next-generated global absent in clean CI) | cloud `typecheck` now runs `next typegen` first |
| 3 | gitleaks flagged synthetic OAuth fixtures in test suites | root `.gitleaks.toml` keeps the full default ruleset, allowlists only test directories |
| 3 | DB test inserted `expires_at < created_at` (violates CHECK) | anchor the fixture's `createdAt` before `expiresAt` for the already-expired case |
| 4 | tenant-isolation + MCP-OAuth suites need the Supabase **Auth API** (not just DB URL) | cloud-db lane now exports `NEXT_PUBLIC_SUPABASE_URL` / publishable / secret keys (service keys masked) |
| 5 | Auth-API-gated integration test carried a pre-Phase-0 assertion (applied op deleted) | update to the Phase-0 semantics (applied ops are terminal & retained for idempotent replay) |

**Status: RUNTIME_PROVEN (DB lane).** The node, engine, drift, infra, and security lanes pass; the
cloud-db lane boots real Postgres + Auth and runs the tenant-isolation, authz, concurrency,
replay/idempotency, atomic-claim, thread-CAS, and recommendation-store suites with
`ADPORT_RUN_DATABASE_TESTS=1`. (The green run is recorded in the exit report with its run id.)

## 0.2 Real Supabase / OAuth read path — BLOCKED_EXTERNAL (no live credentials)

This container has **no** live provider OAuth credentials (Meta/Google/TikTok/Snapchat) and no live
Supabase service for ad data — verified at baseline (no such env secrets). Per the mandate we did
**not** fabricate a live test. Instead:

- The read path is exercised end-to-end against the typed `@adport/core` `ReportRow` boundary and
  synthetic fixtures (tagged `SYNTHETIC`), which flow through the SAME normalization → trust →
  analysis → recommendation path as live data would. See `test/phase2-service.test.ts`.
- Live transport (real OAuth token → provider API → report) remains **UNVERIFIED_LIVE_TRANSPORT**.
  When credentials are provided, the only new surface is the provider adapter's HTTP call; everything
  downstream is already proven.

Priority order for the first live read when credentials exist: **Meta → Google → TikTok → Snapchat**
(read-only, one test account first, no writes). The verification chain to assert: authenticated tenant
→ connection → account → provider reads → `normalizeReportRows` → trust metadata → `analyzeAccount` →
`narrate`/gateway.

## 0.3 Production caller — WIRED (single path)

`lib/markting/intelligence/service.ts#analyzeAndAnswer` is the one production intelligence path:
authenticated `EngineContext` → `analyzeAccount` (deterministic intelligence) → persist hook
(recommendation-store) → governed `AiGateway.invoke` (usage/cost/quota/idempotency) → narrated answer.
There is **no** separate fixture-only intelligence path — fixtures merely supply observations (tagged
`SYNTHETIC`) that run through this same code. With no live model wired yet, the gateway's `run()`
returns the deterministic local narration (recorded free as `local_fallback`); the facts are identical
to what a model would be handed. Proven by `test/phase2-service.test.ts` (path runs, usage recorded,
idempotent per `request_id`, ask-questions answered with evidence).
