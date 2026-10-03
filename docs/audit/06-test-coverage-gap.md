# 06 — Test coverage & gap analysis (QA lead consolidation)

Owner: **F9 (QA lead)**. Sources: the F1–F8 specialist reports under `docs/audit/agents/F*.md`, re-verified by F9 spot-checks (see `docs/audit/agents/F9.md`).
Audit window: 2026-10-02 (F1–F8 ran at commits `d9c79f6` / `f869936` / `f80877c`). F9 re-ran the load-bearing commands on 2026-10-03 at HEAD **`41b069e`** (working tree clean apart from untracked `docs/audit/**`); the counts and code paths below still hold at that HEAD.

> **Readiness caveat (read first).** A green suite here is **not** evidence of production readiness. The suite that is green is a strong *unit/contract* layer around the bridge core; it does **not** exercise the authorization gates on the only human-approval surface, the cloud↔engine wire contract, any browser flow, tenant isolation of reports, concurrency on the apply path, or the Postgres/live code paths the compose stack actually runs. Two safety-critical defects (a reproduced double-apply race, P1; and an engine-host side effect that turns the upstream safety suite red, P2) are invisible to `make test` and to every "N passed" figure in the phase reports. **Do not treat "tests pass" as "safe to run real ad spend."**

---

## 1. Commands executed by the F team (verbatim, with exit codes)

Only commands an F agent actually ran are listed. "✔ F9" marks the ones F9 independently re-ran at HEAD `41b069e` with the same result. Every command was read-only or an existing test/lint/typecheck target; no ad platform, no real credentials, no git mutation, no Docker build (sandbox network blocks image builds — not retried).

### Cloud (vitest) — `platform/`
| Command | Exit | Result | Agent(s) |
|---|---|---|---|
| `pnpm --filter @adport/cloud typecheck` | 0 | `tsc --noEmit` clean | F1 |
| `pnpm --filter @adport/cloud test` (default; `.env.local` present, no Supabase) | **1** | 38 passed / 2 skipped files, **3 failed** DB suites in `beforeAll` (`ECONNREFUSED 127.0.0.1:55322`); 308 tests passed, 32 skipped | F1, F2 |
| `ADPORT_RUN_DATABASE_TESTS=0 pnpm --filter @adport/cloud exec vitest run` | 0 | 38 files passed, 5 skipped; **308 passed, 32 skipped** | F1, F2, F3, F8, **✔ F9** |
| `pnpm --filter @adport/core test` | 0 | 5 files, **41 passed** (incl. `policy-engine.test.ts`) | F1, F8 |
| `pnpm exec vitest run test/policy-engine.test.ts` (`packages/core`) | 0 | **10 passed** (single-use assertion is sequential only) | F6, F7, **✔ F9** |
| `pnpm -r --filter "./packages/*" run test` | 0 | core 41, google 25, apple 20, meta 23, linkedin 46, pinterest 49, reddit 8, microsoft 13, snapchat 37, spotify 45, tiktok 12, x 91, mcp 82, cli 73 — all passed | F1 |
| `pnpm --filter @adport/cloud exec vitest run test/markting-{translate,bridge,engine-client,sandbox,snapchat-wire}.test.ts test/i18n.test.ts` | 0 | 6 files, **53 passed** (5 markting files) | F3 |
| `node f9-double-apply.mjs` (in-memory store + slow provider, imports `packages/core/dist/index.js`) | 0 | two concurrent `apply(samePendingId)` → **`applyWriteCalls: 2`**, both fulfilled, audit `[validated, applied, applied]` | F6, **✔ F9** |

### Engine (pytest/ruff/mypy) — `engine/`
| Command | Exit | Result | Agent(s) |
|---|---|---|---|
| `uv run --frozen pytest -q` | **1** | **19 failed, 158 passed, 3 skipped** — all 19 fail on the stale `engine/workspace/KILL_SWITCH` | F1, F2, **✔ F9** |
| `PAID_MEDIA_KILL_SWITCH_PATH=/nonexistent/KILL_SWITCH uv run --frozen pytest -q` (diagnostic) | 1 | 1 failed, **176 passed**, 3 skipped — the one failure is the test that exercises the real path; confirms the 19 are the stale-file side effect | F1 |
| `uv run --frozen ruff check .` | 0 | all checks passed | F1 |
| `uv run --frozen ruff format --check .` | 0 | 175 files already formatted | F1 |
| `uv run --frozen mypy src` | 0 | no issues in 80 source files | F1 |
| `uv run --frozen python -m pytest -q ../services/engine-demo/tests` | 0 | **7 passed** | F1, F2, F3, F8, **✔ F9** |
| `uv run --frozen mypy ../services/engine-demo/serve_demo.py` (diagnostic) | **1** | 4 × `untyped-decorator` at `serve_demo.py:326,338,355,360` | F1 |
| `uv run --frozen ruff check ../services/engine-demo` / `ruff format --check` | 0 / 0 | clean / 2 files formatted | F1 |
| `uv run --frozen pytest -q tests/contract/test_write_flows_graph.py -k "replayed or concurrent"` | **1** | 2 failed — stale kill switch (F6) | F6 |
| `uv run --frozen python -m pytest -q tests/unit/test_proposals_and_security.py tests/contract/test_console_api.py` | 0 | 18 passed | F8 |
| engine-host failure-injection harness (`httpx.ASGITransport`, demo mode) | 0 | orphan proposal persists and re-surfaces; duplicate reject → 500 (S1–S7, F7) | F7 |

### Infra / build / config
| Command | Exit | Result | Agent(s) |
|---|---|---|---|
| `node --test infra/scripts/stripe-setup.test.mjs` | 0 | **3 passed** | F1, F3, F8 |
| `docker compose config --quiet` (no `.env`) | **1** | `required variable MARKTING_ENGINE_TOKEN is missing` (expected; `env_file: .env` makes it unvalidatable short of creating `.env`) | F1 |
| `ls -a .github` / `git ls-files | grep .github` (root) | 2 / 0 | **no root `.github`**; only nested `platform/.github`, `engine/.github` (inert) | F1, F2, F3, F8, **✔ F9** |
| `git diff --stat fa7bf19 HEAD -- platform/` ; `… 4162146 HEAD -- engine/` | 0 | platform 95 files (+4501/−490); **engine diff empty** (tracked files only) | F1 |

**Not run (deliberately):** `pnpm build` / `build:standalone` (regenerates the tracked `next-env.d.ts`; F1-08), Docker image builds (sandbox network), `paid-media-agent demo --with-proposal` (writes into `engine/workspace/`, refused by the stale kill switch), anything against a live ad platform or live Stripe/IdP.

---

## 2. Test inventory (what exists)

| Suite | Files | Cases | State in this checkout | Gate |
|---|---|---|---|---|
| `platform/apps/cloud` vitest | 43 | 340 (308 pass + 32 skip) | green with gate off; **3 fail** with the leftover `.env.local` and no Supabase | DB suites auto-gate on 4 Supabase vars (`test/setup-env.ts:1-8`) |
| ├ markting bridge core | 6 | translate 21, bridge 8, engine-client 5, sandbox 6, snapchat-wire 5, i18n 8 | green | ungated |
| ├ markting repository (DB) | 1 | 4 | skipped by default; **never in `make test`/CI** | `ADPORT_RUN_DATABASE_TESTS=1` + Supabase |
| ├ upstream DB/HTTP-gated | 4 | `database.integration` 11, `mcp-oauth.database` 1, `account-selection.database` 10, `http.integration` 6 (**2 broken**, F2-05) | skipped/never-run | env-gated |
| ├ upstream cloud (OAuth, plans, headers, waitlist, …) | 31 | 255 | green | ungated |
| `platform/packages/*` vitest | 32 | core 41, google 25, apple 20, meta 23, linkedin 46, pinterest 49, reddit 8, microsoft 13, snapchat 37, spotify 45, tiktok 12, x 91, mcp 82, cli 73 | green (not modified by markting) | ungated |
| `engine/tests` pytest | 29 | 180 collected (177 offline + 3 live-gated) | **19 fail** on stale KILL_SWITCH; 176 pass with the path redirected | 3 live tests need `PAID_MEDIA_LIVE_TESTS=1` |
| `services/engine-demo/tests` pytest | 1 | 7 | green (demo mode, in-memory only) | — |
| `infra/scripts` node:test | 1 | 3 (`stripe-setup`) | green | — |

**Entry-point reality (`Makefile:52-55`):** `make test` runs **only** the 6 markting cloud files + i18n, the 7 engine-host tests, and 3 infra tests (~63 cases). It omits `@adport/core` (the PolicyEngine), every DB-gated suite, the 177-test engine suite, all provider/mcp/cli packages, `tsc`, `ruff`, `mypy`, and `pnpm build`. Nothing runs on push/PR (§6).

---

## 3. Coverage matrix (module × test type)

Legend: ✔ strong · ◑ partial / lower-layer / happy-path-only · ✗ none · n/a not applicable. "neg" = hostile/negative input; "conc" = concurrency; "fail" = failure-injection.

| Module | unit | integration | e2e | neg | conc | fail | Key gaps (finding) |
|---|---|---|---|---|---|---|---|
| `lib/markting/translate.ts` | ✔ | n/a | ✗ | ✔ (hostile fixtures) | n/a | n/a | `after[].unit` ignored (CC-30); no currency check (CC-30) |
| `lib/markting/bridge.ts` | ✔ | ◑ | ✗ | ✔ | ✗ | ◑ | infra-error-as-policy-rejection (CC-09); re-bridge dup (CC-08); readOnly/500 branches |
| `lib/markting/engine-client.ts` | ✔ | ✗ | ✗ | ✔ (status map) | n/a | ◑ | no `AbortError`/timeout test (CC-08); 4xx leak (CC-09) |
| `lib/markting/sandbox-provider.ts` | ✔ | ◑(DB) | ✗ | ◑ | ◑ (CAS load→save) | ✗ | preview→apply CAS gap (CC-13) |
| `lib/markting/repository.ts` | ✗ | ◑ (4 DB tests, gated) | ✗ | ✗ | ◑ (DB, not in CI) | ✗ | RLS from `authenticated` role untested (CC-04); `expired` provenance never written (CC-18) |
| `lib/markting/assistant.ts` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **everything** — thread ownership, engine error map, demo/live switch (CC-04) |
| `lib/markting/runtime.ts`, `env.ts` | ✗ | ✗ | ✗ | ✗ | n/a | n/a | demo/live provider injection untested (CC-04) |
| `app/api/approvals/[id]/apply` + `/reject` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **zero** route tests on the human-approval surface (CC-04); non-atomic (CC-01); reject≠in-flight (CC-07) |
| `app/api/assistant/messages` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | rate-limit, body parse, orphaned proposal on 403 (CC-04, CC-09) |
| `app/api/reports/engine/**` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **cross-tenant read** (CC-02); unmetered runs (CC-10) |
| `app/api/billing/webhook` | ✗ | ◑ (1 DB event) | ✗ | ✗ | ✗ | ✗ | no signed-fixture test; dedupe check-then-act, no ordering (CC-12) |
| `packages/core` PolicyEngine | ✔ (sequential) | ✗ | ✗ | ✔ | ✗ **(race reproduced)** | ◑ | double-apply (CC-01); budget not re-checked at apply (CC-13) |
| providers (meta/google/tiktok/apple/microsoft/reddit) | ◑ | n/a | ✗ | ◑ | ◑ (refresh) | ◑ | silent report truncation (CC-16); pagination untested/missing; 1 error code each |
| providers (linkedin/pinterest/snapchat/spotify/x) | ✔ | n/a | ✗ | ✔ | ✔ (refresh single-flight) | ✔ (non-replay) | the defensive template the 6 older ones lack |
| `services/engine-demo/serve_demo.py` | ◑ (demo) | ✗ | ✗ | ◑ | ✗ | ◑ | live mode, Postgres branch, Arabic intent, half of `assert_fail_closed` (CC-06); strict mypy (CC-21) |
| `engine/**` (vendored) | ✔ (when hermetic) | ◑ (live-gated) | ✗ (console only, not deployed) | ✔ | ✔ (Postgres CAS, not in CI) | ✔ | red on stale KILL_SWITCH (CC-06) |
| i18n catalogue | ✔ (parity) | n/a | ✗ (no rendered check) | ◑ | n/a | n/a | RTL/Arabic rendered only DOCUMENTED_ONLY (CC-15) |
| infra scripts (fill-env, sync-supabase-env, seed-demo) | ✗ | ✗ | ✗ | ✗ | n/a | n/a | seed grants `tools:write` + alias map, untested (CC-22) |

**Cross-cutting:** **e2e = ✗ for every product row.** There is no committed browser/Playwright suite; the only `e2e/` dir (`engine/tests/e2e/console_walkthrough.mjs`) drives the upstream setup console, a surface markting-ai never deploys, and Playwright is unresolvable from both trees (F3-01/F3-02). **CI = ✗ for every row** (§6).

---

## 4. Critical-chain regression scenarios

Chain: **AI recommendation → preview (`validate`) → pending row → human approval → provider apply**. Status from F8's 62-scenario matrix (`agents/F8.md` §"Scenario matrix"), consolidated to the load-bearing rows. **COVERED** = an automated test asserts it; **PARTIAL** = tested at a lower layer or happy-path only; **MISSING** = no test. Layer: U unit, DB Postgres, E engine-host, R route, X cross-stack.

| ID | Scenario | Existing test → status |
|---|---|---|
| H1 | Proposal → one hash-bound pending row, `validated` audit, no `applyWrite`, hand-off reject | `markting-bridge.test.ts:49-67` → **COVERED (U)** |
| H2 | Apply identical op+id → provider write, `applied` audit, consumed | `markting-bridge.test.ts:69-79`; `database.integration.test.ts:349-380` → **COVERED (U,DB)** |
| H3 | Altered payload at apply → `PENDING_MISMATCH` | `markting-bridge.test.ts:81-88` → **COVERED (U)** |
| H5 | Preview→apply round-trip for Google/Meta/Reddit/TikTok (zod re-parse = same hash) | Snapchat only → **MISSING for 4 providers** |
| H7 | Full `runAssistantTurn` (thread claim → engine → bridge → provenance) | none → **MISSING (R/X)** |
| H8 | Engine host emits a proposal that passes `proposalViewSchema` (drift guard) | engine-side shape only; TS fixture hand-written → **MISSING (X)** |
| N1–N5 | Unknown alias / look-alike tool / platform mismatch / hostile budgets / status injection / prose cannot pick account | `markting-translate.test.ts:85-119` → **COVERED (U)** |
| N6 | Proposal in non-`awaiting_approval` state is not bridged | none → **MISSING (U)** |
| U2 | `unit: micros`/`cents`/unknown → should be `unsupported`; today silently ×1e6 | none → **MISSING (U)** (CC-30) |
| U4 | Alias currency ≠ account currency | none → **MISSING** (CC-30) |
| P0 | 25% delta cap at preview → `rejected_by_policy` | `markting-bridge.test.ts:90-99` → **COVERED (U)** |
| P2 | Account protected between preview and apply → refused | none → **MISSING (U)** (CC-13) |
| P3 | Budget cap tightened between preview and apply | today apply succeeds → **MISSING** (CC-13) |
| T1 | Apply after expiry (core) → `PENDING_EXPIRED` | `policy-engine.test.ts:115-130` → **COVERED (U, file store only)** |
| T2 | Apply after expiry via Postgres/route → 404 (sweep turns it into NOT_FOUND) | none → **MISSING (DB,R)** (CC-19) |
| T3 | Sweep marks expired consumed; provenance should become `expired` | none → **MISSING (DB)** (CC-18) |
| **A1** | Unauthenticated apply/reject → 401 | none → **MISSING (R)** |
| **A2** | Viewer applies/rejects → 403/403 | none → **MISSING (R)** |
| **A3** | Member applies/rejects → 403/200 | none → **MISSING (R)** |
| **A4** | Creator applies own preview, flag unset → 403; `true` → 200 | none → **MISSING (R)** (CC-03) |
| **A5** | Reader plan (no `tools:write`) applies → 403 | plan stripping tested elsewhere → **PARTIAL** |
| A9 | Assistant route rate limit → 429 | none → **MISSING (R)** |
| **X1** | Org A applies/rejects org B's pending id → 404 | none at route → **MISSING (R/DB)** |
| X3 | Alias map tenant scoping; cross-org provenance empty | `markting-repository.database.test.ts:46-72` → **COVERED (DB)** |
| X4 | Foreign thread id rejected (regex + `claimThread`) | DB test for claim; regex untested → **PARTIAL** |
| **Xr** | Org B lists/downloads org A's engine reports | **leaks today** (CC-02) → **MISSING** |
| F1 | Provider throws at `applyWrite` → 502, row open, no `applied` audit; add `apply_failed` | none → **MISSING (U)** (CC-07/CC-01) |
| F2 | Provider accepted mutation but response errored; second Apply → double mutation | none → **MISSING (U)** (CC-01) |
| **C2** | Two concurrent applies of one id → exactly one mutation | **none; race reproduced** → **MISSING (U)** (CC-01) |
| **C3** | Concurrent apply + reject → one wins | none → **MISSING (DB)** (CC-07) |
| R1 | Same proposal bridged twice (hand-off failed) → one pending row | bridge creates a new row each time → **MISSING (U)** (CC-08) |
| E1 | Engine restart (memory persistence) → `/reject` 409 `unknown_proposal` | none → **MISSING (E/X)** |
| E2 | Reject twice on host → second 500 | `test_demo_api.py` rejects once → **MISSING (E)** (CC-24) |
| E4 | Engine cannot write even if approved (kill switch / `ProposalOnlyWriteProvider`) | `test_demo_api.py:66-154` → **COVERED (E)** |
| E5 | `EngineClient` has no approve/edit path | `markting-engine-client.test.ts:25-34` → **COVERED (U)** |

**Totals (F8, spot-checked by F9):** 62 scenarios → **24 COVERED, 11 PARTIAL, 27 MISSING.** Every MISSING item in the authorization (A), cross-tenant (X) and concurrency (C) groups touches the human-approval invariant directly. **The strongest coverage is on what the bridge does with a proposal; the weakest is on who may apply it and what happens under concurrency or failure.**

---

## 5. Highest-value regression tests to add (priority order)

1. **Concurrency**: two `Promise.all` applies of one pending id against a provider stub that counts `applyWrite` → assert exactly one call (C2); apply-vs-reject race (C3); reject-then-apply → 404 (C4). Mirror against Postgres. *(Guards CC-01, CC-07; the P1 defect ships untested today.)*
2. **Route authorization** (invoke the `POST` handlers with `vi.mock('@/lib/cloud/auth')`): A1 401, A2 viewer 403, A3 member 403/200, A4 self-approval both flag values, A5 reader-plan 403, A9 429, X1 cross-org 404. *(Guards CC-03, CC-04; the only human-approval surface has zero tests.)*
3. **Cross-tenant reports**: org B cannot list/download org A's runs (Xr). *(Guards CC-02 before the surface ever sees non-fixture data.)*
4. **Cloud↔engine contract**: boot `serve_demo.build_app_async` in-process, drive `EngineClient` → `translateProposal`, assert the proposal parses with `proposalViewSchema` and maps to `daily_budget_micros: 240_000_000` (H8); validate the TS fixture against the engine's pydantic JSON schema. *(Guards silent wire drift; CC-14.)*
5. **Failure injection at apply**: provider throws (F1) and audit/delete throws after a successful write (F2) → assert an `apply_failed` marker and that a retry is detected. *(Guards CC-07.)*
6. **Hermetic engine suite**: pin `PAID_MEDIA_KILL_SWITCH_PATH` under `tmp_path` so `uv run pytest` is 176-green regardless of host runs. *(Guards CC-06.)*
7. **RLS**: an `authenticated`-role client asserting zero rows on all four `markting_*` tables (CC-04).
8. **Browser e2e** (Playwright, `ar`+`en`): the 24-row matrix in `agents/F3.md` §A, starting with two-person approval (requester 403, second person 200) under `MARKTING_ALLOW_SELF_APPROVAL=false`. *(Guards CC-03, CC-15; converts the DOCUMENTED_ONLY phase-report walkthroughs into repeatable specs.)*

---

## 6. CI proposal

**Today there is no CI** (verified: no root `.github/`; the nested `platform/.github/workflows/ci.yml` and `engine/.github/workflows/ci.yml` are never evaluated by GitHub for this repo and assume they are at a repo root). Add a single root `.github/workflows/ci.yml`, `concurrency: ci-${{ github.ref }}`, `permissions: contents: read`, on `push:[main]` / `pull_request` / `workflow_dispatch`. Neutralise the two nested workflows so they do not imply CI exists.

**Job 1 — `platform`** (`working-directory: platform`, Node 22): `pnpm install --frozen-lockfile` → `pnpm build` (turbo `test` depends on `build`) → `pnpm typecheck` → start Supabase via the CLI (`npx supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector`; a bare `postgres` container is insufficient — migrations need `auth.users`, pg_cron and the `adport_backend` role) → export the 4 Supabase vars → **set `ADPORT_RUN_DATABASE_TESTS=1` explicitly** (so a missing DB *fails* instead of silently skipping, CC-20) → preflight `psql -c 'select 1 from public.markting_engine_proposals limit 0'` → `pnpm test`. Keep the upstream CLI-smoke step (exercises the file-backed `PendingStore`). Upload JUnit output.

**Job 2 — `engine`** (`working-directory: engine`, Python 3.11+3.13): `uv sync --frozen --all-extras --dev` → `ruff check .` → `ruff format --check .` → `mypy src` → **`PAID_MEDIA_KILL_SWITCH_PATH=$RUNNER_TEMP/KILL_SWITCH pytest -q`** (pin the path so the suite is hermetic, CC-06) → `pytest -q ../services/engine-demo/tests` → `mypy ../services/engine-demo/serve_demo.py` (currently fails, CC-21) → `paid-media-agent demo --with-proposal`. Carry the Gitleaks job over.

**Job 3 — `infra`** (Node 22): `node --test infra/scripts/*.test.mjs` → `node --check infra/seed/*.mjs infra/scripts/*.mjs` → `docker compose -f docker-compose.yml config -q` (validate without building). Add tests for `fill-env`, `sync-supabase-env`, `seed-demo` (CC-22).

**Job 4 — `bridge-contract`** (new, cross-stack): boot `serve_demo.py` offline in demo mode, run a gated `markting-contract.engine.test.ts` that asserts H8 (schema + translate), E2 (reject twice), E1 (restart → 404/409). This is the only place engine→cloud schema drift is caught before it reaches `translate.ts`.

**Nightly** (secrets): browser e2e matrix (`agents/F3.md` §A), real Stripe test-mode Checkout, `MARKTING_ENGINE_MODE=live` canary (fail-closed asserts hold; a change request still yields a pending row, never an engine write).

**Also:** make `make test` call the same commands as Job 1+2+3 so local == CI; add a hygiene check that fails if `engine/workspace/` or `platform/` hold untracked non-ignored files after a run; add the `UPSTREAM.md`-SHA diff guard (`docs/TODO.md:21`).

---

## 7. Why "green" is not "ready" (summary for reviewers)

- The green figure (`308/32` cloud, `176` engine hermetic, `7` host, `10` core, `53` bridge) covers **translation, the two-step gate as a library, and the Snapchat wire**. It does **not** cover the authorization layer, concurrency, tenant isolation of reports, the engine wire contract, or any browser flow.
- Two safety-critical issues are **invisible** to the green path: the **double-apply race** (reproduced: `applyWriteCalls: 2`) is only "single-use" in a sequential test, and the **stale KILL_SWITCH** turns the upstream safety suite red (19 failures) yet `make test` never runs that suite.
- The phase reports' Playwright "walkthroughs" have **no committed artifact** and cannot be reproduced (DOCUMENTED_ONLY).
- The DB-gated suites — the only tenant-isolation/RLS/concurrency evidence that exists — **never run in CI and cannot run in this sandbox**, so their assertions are VERIFIED_CODE (read), not VERIFIED_TEST (executed).

Readiness requires: the §5 regression tests added, the §6 CI running them on every PR (including the DB and cross-stack lanes), the P0/P1/P2 defects in `agents/F9.md` fixed, and a live-mode canary — **before** any configuration that can touch real ad spend is enabled.
