# Phase 0 report — import and verify

Date: 2026-10-01/02. Branch: `claude/amazing-heisenberg-0unnak` (mirrored to `setup/import`). Nothing inside `platform/` or `engine/` was modified.

## 1. What was imported

| Directory | Project | Upstream commit | Files |
| --- | --- | --- | --- |
| `platform/` | adport (ynnickw/adport) | `bde6fedaf380f38fa3aa0df725d6323c15991dd4` (2026-10-01) | 447, byte-identical to upstream `git ls-files` |
| `engine/` | paid-media-agent (langchain-ai/paid-media-agent) | `0cc8109a1984377a573ed8d202b3b054db4d7b90` (2026-09-13) | 239 incl. 3 relative symlinks and 4 force-added `.gitkeep` |

Both are Apache-2.0. Upstream `LICENSE` files stay in place; neither upstream ships a `NOTICE`. Root `NOTICE` and `UPSTREAM.md` record both imports.

## 2. Verification environment

| Item | Value |
| --- | --- |
| Host | Linux, 4 vCPU, 15 GB RAM, cloud sandbox behind an HTTPS allow-list proxy |
| Node / pnpm | 22.22.0 / 11.8.0 (corepack honoured `packageManager`) |
| Python / uv | 3.11.15 / 0.8.17 |
| Docker | 29.6.2 (daemon started manually); image pulls from Docker Hub work |
| Supabase CLI | 2.119.0 via `npx supabase` |

## 3. adport (`platform/`) — build and test, per README "Development" and `.github/workflows/ci.yml`

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | OK |
| `pnpm build` (turbo, 15 workspaces incl. `next build` of `apps/cloud`, 47 routes) | OK |
| `pnpm typecheck` | OK |
| `pnpm test` | OK. Per package: core 41, google 25, meta 23, tiktok 12, apple 20, microsoft 13, reddit 8, snapchat 37, spotify 45, pinterest 49, linkedin 46, x 91, mcp 82, cli 73, cloud 255 passed + 28 skipped (DB/HTTP-gated) |
| `node scripts/build-provider-pages.mjs --check`, `node --test scripts/test-provider-pages.mjs`, `node --test scripts/test-connector-catalog.mjs` | OK |
| CLI fail-closed: `adport accounts --json` with no credentials | exit 1, `{"error":"NOT_CONNECTED"}` (expected) |
| `adport --demo accounts --json` | 2 synthetic accounts (`mock-1` Acme DTC Store EUR, `mock-2` Beta App USD) |
| `adport --demo report --metrics spend,clicks,roas`, `--range last_7_days` | 4 campaign rows |
| `adport --demo audit run` → `recommendations list` | 1 CRITICAL `zero-conversion-spend` finding with a ready-to-apply action |
| `adport policy` | defaults: `require_validation`, `paused_creation`, `max_budget_delta_pct: 25`, `pending_ttl_minutes: 15` |
| `adport --demo mcp` (stdio JSON-RPC) | initialize OK (adport 0.6.1), `tools/list` = 12 tools (`accounts_list`, `report`, `audit_*`, `recommendation*`, `mock_list_campaigns`, `mock_create_campaign`, `mock_set_budget`, `mock_set_campaign_status`, `mock_remove_campaign`), `tools/call accounts_list` OK |
| `supabase start` (ports 553xx) | OK, 8 migrations + `seed.sql` applied |
| Cloud tests with local DB (`apps/cloud/.env.local`, gitignored, local dev keys only) | 267 passed, 16 skipped |
| `build:standalone` + server on :3100 | OK: `/` 200 sign-in, `/dashboard` 307 → `/`, `/api/v1/accounts` and `/mcp` 401 without a token, OAuth AS metadata served |
| Cloud tests with `ADPORT_HTTP_TEST_BASE_URL` + `ADPORT_SELECTION_TEST_DATABASE_URL` | 281 passed, **2 failed** (see 5.1) |

## 4. paid-media-agent (`engine/`) — build and test, per README, `Makefile` and `.github/workflows/ci.yml`

| Step | Result |
| --- | --- |
| `uv sync --frozen --all-extras --dev` | OK |
| `ruff check .`, `ruff format --check .` | OK |
| `mypy src` | OK, 80 files |
| `pytest -q` | 177 passed, 3 skipped (live integration) |
| `paid-media-agent demo` | OK: fixture analysis over `demo-google`, `demo-meta`, `demo-reddit`, no model, no network |
| `paid-media-agent demo --with-proposal` | OK: ChangeSet `presentation/1`, state `awaiting_approval`, `google_ads__update_campaign_budget` on `g-103` 300 → 240, then a simulated receipt `status=verified` against the fixture provider |
| `paid-media-agent doctor` | OK: writes disabled (default), kill switch clear, 6 operations admitted against the fixture catalog, WeasyPrint ready |
| `python -c "import agent"` (MDA definition) | OK |
| `paid-media-agent report --cadence weekly` | OK without a model: wrote `workspace/out/rpt_*.html` and `.pdf` |
| `paid-media-agent serve` in-memory with `PAID_MEDIA_API_TOKENS=token:caller` | OK: `/health` 200 `{persistence: memory, catalog_source: fixture, writes_enabled: false}`; 401 without bearer; `POST /threads/{id}/messages` returns 200 with a structured model-failure text when no model key is set |
| `paid-media-agent serve` with `DATABASE_URL` → `postgres:16-alpine` container | OK: `/health` `persistence: postgres`; tables created `pma_proposals`, `pma_approvals`, `pma_receipts`, `pma_dedupe`, `pma_thread_owners` plus LangGraph `checkpoint*` |
| `docker build` of the upstream `Dockerfile` | **Not possible in this sandbox** (see 5.2) |
| `docker compose up` | Not runnable here for the same reason; the API+Postgres topology was exercised directly as above |

## 5. What fails

### 5.1 Upstream test defect (not fixed, per Phase 0 rules)
`apps/cloud/test/http.integration.test.ts` fails 2 of 6 cases when run against a live server:
`Error: This workspace does not grant any of the requested MCP scopes` from `lib/cloud/mcp-oauth-repository.ts:129`.
The test calls `createMcpAuthorizationCode({ organizationId, userId, scopes: [] }, { scopes: ['tools:read'] })`; the scope filter was added upstream in commit `4d24e8e` (2026-08-28, "add commercial plans and agent plugins") and the test was last updated 2026-08-25. These two cases are opt-in (skipped in upstream CI) and only run with `ADPORT_HTTP_TEST_BASE_URL` set. Everything else passes.

### 5.2 Sandbox network policy, not a project defect
Building the engine image runs `apt-get` against `deb.debian.org`, which this environment's network policy denies (HTTP 403 from the proxy, over both HTTP and HTTPS). The host would need to be added to the environment's allowed domains, or Docker images built on your machine. A sandbox-only Dockerfile variant with the proxy CA installed (kept in scratch, never committed) failed on the same host block, which confirms the cause.

### 5.3 Things that work only partially without credentials (expected)
- Engine `ask`/chat needs a model key (`ANTHROPIC_API_KEY`, etc.); `report` and `demo` do not.
- Cloud app provider OAuth cards stay "Awaiting app approval" until the provider env blocks are set; builds and tests do not need them.
## 6. Findings from the code that change the later phases

Each item was confirmed in the code by at least one reader and re-checked by an adversarial verifier (see `docs/ARCHITECTURE.md` for citations).

1. **Snapchat already exists in adport.** `platform/packages/snapchat` ships OAuth with refresh-token rotation, accounts, normalized reports, three guarded writes (`snapchat_create_campaign`, `snapchat_set_budget`, `snapchat_set_campaign_status`), 37 wire-format tests, a CLI connect wizard, cloud OAuth wiring and docs. Phase 3 as written ("create packages/snapchat") would duplicate it. Proposed re-scope in section 7.
2. **adport's Approvals page is display-only.** `app/dashboard/approvals/page.tsx` lists `pending_operations` rows; there is no approve, apply or reject control anywhere in the cloud app. Applying happens only when a client re-calls the same write tool with `pending_operation_id` through REST (`/api/v1/tools/[tool]`) or remote MCP (`/mcp`). Phase 1's "appears in the Approvals page" is directly achievable; "approve from the dashboard" is new UI that must itself go through `registry.call`.
3. **The single write path is structural in adport.** Every mutation is exposed only through `guardedWriteTool`, whose handler calls `PolicyEngine.validate` or `PolicyEngine.apply`; `provider.applyWrite` is invoked only from `PolicyEngine.apply`. The hosted runtime injects `PostgresPendingStore`/`PostgresAuditStore`, so a bridge that calls the tenant runtime's registry lands rows exactly where the Approvals page reads them. A bridge must never insert into `pending_operations` directly: `apply` re-hashes the operation and rejects anything not produced by `validate`.
4. **The engine never exposes provider account ids.** Proposals carry an opaque alias (`account_ref`, e.g. `demo-google`), the engine `Platform` enum (`google_ads`), `tool_name` like `google_ads__update_campaign_budget`, `target_ref` (campaign id) and `before`/`after` field lists in account currency. The alias → adport provider/account mapping, the tool mapping and the currency → micros conversion all have to live on the bridge side.
5. **Engine live writes are already unreachable by configuration, and can be hard-blocked.** With no `PIPEBOARD_API_TOKEN` the catalog is fixture-only and the write provider is `FakeWriteProvider`; `PAID_MEDIA_WRITES_ENABLED` defaults to false; the `workspace/KILL_SWITCH` file makes `WriteGate.check` refuse every execution (including fakes) and is re-evaluated per call. Caveat: approving under the kill switch turns the proposal `rejected`, so the bridge should treat engine proposals as source material and never call the engine's approve endpoint.
6. **Engine chat needs a real model key even on synthetic data.** `serve` resolves `PAID_MEDIA_MODEL` with `init_chat_model`; the scripted offline model is wired only into the `demo` CLI command. The Assistant page will therefore need a model API key in `.env`; the Reports path does not.
7. **The engine has no HTTP report trigger.** `GET /threads/{id}/artifacts/{name}` serves only files that an agent thread rendered. The deterministic `run_cadence_report` is reachable from Python (as the CLI does) but not over HTTP, so a Reports page needs a small new route or a job that runs `paid-media-agent report --json` and reads `workspace/out/rpt_*.html|pdf|json` from the shared volume.
8. **Browser → engine calls are blocked by design.** The cloud app's CSP is `connect-src 'self' <supabase>` and the engine has no CORS, so the Assistant chat must go through a Next.js server route that holds the engine token. This matches the "token never exposed to the browser" rule.
9. **Plan gating.** The default free `reader` plan has `writeAccess=false`, so API-key and MCP tokens are read-only until an `organization_subscriptions` row grants a paid plan. Bridge tests and the local demo must seed a plan or use a session principal with write scope.
10. **Engine API hygiene notes for the bridge.** Threads are owned by the first `caller_ref` that uses them; `POST /proposals/{id}/reject|edit` check only that the bearer is valid; tokens are plaintext `token:caller` pairs; chat calls are synchronous and can run minutes (no streaming). The adport route needs a long timeout and should namespace thread ids per organization.
11. **Upstream nits worth knowing** (not fixed): `require_validation` policy flag is never read by the engine; budget caps are re-checked only at preview, not at apply; cloud `pending_operations` rows are soft-deleted (`consumed_at`); `/api/members` DELETE reads query params while the client sends a JSON body; the cloud `.env.example` and docs still say "six providers" while eleven are wired; adport `CHANGELOG.md` stops at 0.5.2 while packages are 0.6.1.
## 7. Proposed integration plan

Three independent plans were drafted (minimal-upstream-diff, safety-first, product-first) and scored by two judges who re-opened the cited code. The product-first design won on both scorecards; the safety-first write-boundary measures are grafted in. The judges also caught that two plans' demo mappings (engine `g-103` 300 → 240 USD onto adport's mock campaigns with 10–25 EUR budgets) would be rejected by adport's default 25 % budget-delta cap, which is why the plan below uses a sandbox provider that mirrors the engine fixture instead of `MockProvider`.

### 7.1 Principles
- **One write path.** Provider mutations happen only inside `PolicyEngine.apply` → `provider.applyWrite` (`platform/packages/core/src/policy/engine.ts:113`). Everything new reaches it through `registry.call` on a tenant runtime, never through a provider client and never by inserting into `pending_operations`.
- **The engine only proposes.** It runs with no Pipeboard token, `PAID_MEDIA_DATA_MODE=sample`, `PAID_MEDIA_WRITES_ENABLED=false`, no approvers, the `workspace/KILL_SWITCH` file present, and (grafted from safety-first) its write provider replaced at boot by a `ProposalOnlyWriteProvider` whose `call_mutation` raises. The bridge has no client method for `/proposals/{id}/approve`; a test asserts it is never requested.
- **Glue lives outside the upstream trees where Next.js and pytest allow it**; the unavoidable edits inside `platform/apps/cloud` are additive files plus a short list of touched files recorded in `UPSTREAM.md`. No file in `engine/` changes in Phases 1 and 2.

### 7.2 Topology (`docker-compose.yml` at the root)

| Service | Source | Notes |
| --- | --- | --- |
| `cloud` | new `infra/cloud.Dockerfile`, context `./platform` | `pnpm install --frozen-lockfile && pnpm build && pnpm --filter @adport/cloud build:standalone`; runs the standalone `server.js`. The only published port (3000). |
| `engine` | upstream `engine/Dockerfile` unchanged, `command: python /opt/markting/serve_demo.py` with `./services/engine-demo` mounted read-only | Builds the self-hosted runtime via `build_self_hosted_runtime(model=…)` with the model override the code already exposes, so demo mode needs **no model key**; a `live-model` compose profile runs plain `paid-media-agent serve` with a real key. Not published to the host. |
| `engine-db` | `postgres:16-alpine` | Same as upstream compose; the engine creates its `pma_*` tables itself (verified in Phase 0). |
| Supabase | `supabase start` from `platform/` (CLI), not a compose service | adport's migrations need `auth.users`, `pg_cron` and the `adport_backend` role, so a plain Postgres image cannot host them. `make up` runs `supabase start` then `docker compose up`; the cloud container reaches it through `host.docker.internal`. Verified working in this sandbox with Supabase CLI 2.119.0. |
| `seed` | one-shot Node script | Creates the demo user through Supabase Auth so `handle_new_user` fires, upgrades the org to the `operator` plan (fresh orgs are `reader`, which strips `tools:write`), completes onboarding, inserts the alias map. |

Secrets: root `.env.example` only; `infra/scripts/gen-env.sh` generates the encryption key, pepper, MCP signing key and the engine bearer token into a gitignored `.env`.

### 7.3 Bridge: engine proposal → adport preview → Approvals page
1. Browser → `POST /api/assistant/messages` (same origin; the cloud CSP forbids anything else). The route takes `sessionPrincipal()`, requires `tools:write`, rate-limits, and calls the engine `POST /threads/{org}:{user}:{thread}/messages` with the server-held bearer. Thread ids are namespaced per organisation and ownership is tracked in a new `markting_threads` table because the engine's thread ownership is first-caller-wins on one `caller_ref`.
2. When the reply carries `proposal.state == "awaiting_approval"` with an unseen `(proposal_id, revision)`, the `ProposalView` is treated as hostile input: zod-validated, `tool_name` matched against a fixed allowlist (`*__update_campaign_budget` → `<provider>_set_budget`, `*__update_campaign_status` → `<provider>_set_campaign_status` or `standardActions().pauseCampaign`), `account_ref` resolved only through an org-scoped `markting_account_aliases` table, units converted explicitly per provider (micros for Google/Snapchat/sandbox, cents for Meta, float units for TikTok), status vocabularies mapped per provider. Anything else becomes `translation.status = "unsupported"` and never touches the registry.
3. `runtime.registry.call(tool, {account_id, ...payload}, ctx)` **without** `pending_operation_id` → `guardedWriteTool` → `PolicyEngine.validate` → a `pending_operations` row plus a `validated` audit event. The existing Approvals page lists it immediately. Provenance: an audit `note` event with `tool = 'engine_proposal'` and a row in `markting_engine_proposals` (idempotency, link to the engine `proposal_id`/`payload_digest`).
4. The bridge then `GET`s the engine proposal and, only if still awaiting, `POST /proposals/{id}/reject` with "handled by adport pending <id>" so the engine thread resumes. Rejecting a proposal that already moved on is an uncaught 500 upstream, so 409/500 are treated as "already handled".
5. **Apply/reject in the dashboard (new UI).** `POST /api/approvals/[id]/apply` replays the stored post-parse `operation.payload` plus `pending_operation_id` through `registry.call` (so `hashOperation` matches); reject marks the row consumed and writes a `rejected` audit event. Approver must differ from `created_by` unless an explicit env flag allows self-approval. The 15-minute pending TTL stays; longer human loops re-validate.

Bridged proposal record (stored, synthetic-test fixture format):
```json
{ "schema": "markting.bridge/1",
  "engine": { "proposal_id": "…", "revision": 1, "platform": "google_ads", "account_ref": "demo-google",
              "tool_name": "google_ads__update_campaign_budget", "target_ref": "g-103",
              "before": [{"field": "daily_budget", "value": 300, "unit": "USD/day"}],
              "after":  [{"field": "daily_budget", "value": 240, "unit": "USD/day"}],
              "reason": "…", "risk": "medium", "risk_flags": ["budget_delta"], "payload_digest": "…" },
  "adport":  { "provider": "sandbox", "tool": "sandbox_set_budget",
               "input": { "account_id": "fixture-google-0001", "campaign_id": "g-103", "daily_budget_micros": 240000000 } },
  "translation": { "status": "ok", "notes": ["240 USD/day → 240000000 micros"] },
  "handoff": { "pending_operation_id": null, "expires_at": null, "engine_rejected": false } }
```

### 7.4 Demo mode without credentials or a model key
- **Cloud side:** `createTenantRuntime` never includes a mock provider and the DB forbids `mock`/`demo` in `connections`. Add a `SandboxProvider` (modelled on core's `SyntheticProvider`, state in a new `markting_demo_state` table) mirroring the engine fixture accounts and campaigns (`g-101/180`, `g-102/420`, `g-103/300` USD) so both sides show the same data and the 300 → 240 proposal passes the 25 % cap. Enabled by `MARKTING_DEMO_MODE=true` through a bridge-owned env module; `/mcp` and `/api/v1` keep the upstream runtime untouched.
- **Engine side:** `services/engine-demo/serve_demo.py` injects a looping scripted model (engine's own `ScriptedChatModel` + demo steps) and asserts fail-closed settings at boot.

### 7.5 Reports page
The engine has no HTTP report trigger and CLI reports are not reachable through its artifact route. Phase 1 runs `paid-media-agent report --cadence weekly --end <today-2> --json` in the engine container on start (and on demand via the bridge route exec hook), writes to the shared `engine-workspace` volume, and the cloud serves `rpt_*.html/.pdf` through `app/api/reports/engine/[name]` as attachments (never inline on the dashboard origin) with the machine-readable `art_*.json` payload rendered natively in the page.

### 7.6 Tests (synthetic only)
- `platform/apps/cloud/test/markting-bridge*.test.ts`: translation table over fixture `ProposalView` JSON validated against each provider's real zod input schema; `bridge()` with in-memory `PendingOperationStore`/`AuditEntryStore` and `SandboxProvider`; asserts one pending row per proposal, `hashOperation` equality, `applyWrite` not called at validate, `PENDING_MISMATCH` on altered args, reader-plan 403, over-cap `POLICY_VIOLATION`, hostile fixtures (unknown tool, foreign alias, negative/huge budget, status injection) rejected before any registry call, and that `fetch` never hits `/approve` or `/edit`.
- `services/engine-demo/tests/test_demo_api.py`: scripted runtime + `create_app`; asserts `awaiting_approval` is reached, `/health.writes_enabled` is false, kill switch present, `/approve` under the kill switch yields a `rejected` receipt, write provider is `ProposalOnlyWriteProvider`.
- `infra/scripts/smoke.sh` (Docker): seed → login → chat → pending row → apply.

### 7.7 Phase mapping and re-scoping
- **Phase 1:** everything above. Upstream files touched inside `platform/apps/cloud`: `components/nav.tsx` (two nav items), `app/dashboard/approvals/page.tsx` (approve/reject actions), `app/dashboard/reports/page.tsx` (AI report card), one new migration under `platform/supabase/migrations/` for the `markting_*` tables with `adport_backend` grants and RLS. Everything else is new files.
- **Phase 2 (Arabic/RTL):** `app/layout.tsx` sets `lang`/`dir` from a locale cookie; `components/ui.tsx` passes the locale to `Intl`; `globals.css` has 32 physical-direction declarations and one logical, so convert to logical properties and add a self-hosted OFL Arabic face under `public/fonts` (the CSP blocks Google Fonts); dictionaries `messages/{ar,en}.json` replace inline copy in nav, shell and every dashboard page. Engine PDF reports hard-code `lang="en"` and ship only DejaVu fonts; Arabic PDFs would be done by passing forked templates to `ReportRenderer(templates_dir=…)` from the demo host, without editing `engine/`.
- **Phase 3 (Snapchat): re-scope from "create" to "enable, bridge, verify".** `packages/snapchat` already exists with OAuth, accounts, reports, three guarded writes and 37 wire tests. Phase 3 becomes: turn on `SNAPCHAT_OAUTH_ENABLED` with user-owned client credentials in the compose env (leave `ADPORT_PROVIDER_TEST_ORGANIZATION_IDS` unset: an empty string denies all orgs), add `snap_ads → snapchat` translation rows and sandbox Snapchat campaigns with synthetic tests, re-run the upstream wire tests, and write a live-verification checklist. On the engine side `snap_ads` has no fixture data, normalization or admitted writes; adding those means editing `engine/`, which I recommend proposing upstream rather than patching locally.
- **Phase 4:** bilingual README, `docs/TODO.md` (billing, WhatsApp approvals, Salla/Zid, production gates), a "local modifications" section in `UPSTREAM.md`, `scripts/check-upstream-edits.sh` diffing against the recorded SHAs, merge to `main`.

### 7.8 Decisions I need from you before Phase 1
1. Supabase outside compose (`make up` = `supabase start` + `docker compose up`) is acceptable, or should Phase 1 attempt a vendored self-hosted Supabase stack?
2. Add approve/reject buttons to the Approvals page (new write UI, still through the registry), or keep adport's "second call from the agent/API" model?
3. Demo mode via a new `SandboxProvider` mirroring the engine fixture (recommended) versus adport's existing `MockProvider` (fails the 25 % cap for the engine's demo proposal).
4. Engine identity: one service token with org-namespaced thread ids (recommended, simplest) versus one engine token per adport user.
5. Branch: this work is on the session branch `claude/amazing-heisenberg-0unnak`; I have also pushed the same commits to `setup/import` as requested. Tell me which one you want to keep.

## 8. How this report was produced
`docs/ARCHITECTURE.md` was written from the imported sources by nine subsystem readers (one per area), synthesized into one document, then checked by ten adversarial verifiers that re-opened every cited file. They checked 649 claims and flagged 113 (20 wrong, mostly over-broad statements; 74 misleading, mostly line-number drift). A fixer re-checked each flag against the code and applied 34 substantive corrections, rejecting 2 reviewer claims that were themselves off by one line. The integration plan is a synthesis of three independently drafted plans scored by two judges who verified their citations. Remaining uncertainties are listed in `docs/ARCHITECTURE.md` section 6.
