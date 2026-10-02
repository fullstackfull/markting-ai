# Phase 1 report — wire adport and paid-media-agent together

Date: 2026-10-02. Decisions applied (all "recommended" options): Supabase outside compose via the CLI,
approve/reject buttons in the dashboard, a sandbox provider mirroring the engine fixtures, one engine
service token with organization-namespaced threads, work on `setup/import`.

## 1. What was built

| Deliverable | Where | Notes |
| --- | --- | --- |
| One-command stack | `docker-compose.yml`, `Makefile`, `.env.example`, `infra/cloud.Dockerfile`, `infra/scripts/*.mjs` | `make env` → `make up` → `make seed`. Supabase starts through its CLI (adport's migrations need `auth.users`, pg_cron and the `adport_backend` role), then compose starts `cloud`, `engine`, `engine-db`. The engine is not published to the host. |
| Engine host (proposal-only) | `services/engine-demo/serve_demo.py` | Boots paid-media-agent's self-hosted runtime with the write provider replaced by `ProposalOnlyWriteProvider` (its `call_mutation` raises), the `KILL_SWITCH` file created, no approvers, and fail-closed assertions that refuse to start if any live credential or write flag is set. `MARKTING_ENGINE_MODE=demo` injects the engine's own scripted model (no model key); `live` uses `PAID_MEDIA_MODEL`. Adds `POST /reports/run`, `GET /reports`, `GET /reports/files/{name}`, `GET /markting/info`. **No file in `engine/` changed.** |
| Assistant page | `platform/apps/cloud/app/dashboard/assistant/`, `app/api/assistant/messages/route.ts`, `lib/markting/assistant.ts` | Chat UI → same-origin server route → engine with a server-held bearer token (the cloud CSP forbids anything else). Threads are namespaced `org_<org>__u_<user>__<id>` and ownership is enforced in `markting_threads`. |
| Reports page | `app/dashboard/reports/engine-reports.tsx`, `app/api/reports/engine/**` | Trigger weekly/monthly deterministic reports on the engine and download HTML/PDF as attachments (never rendered inline on the dashboard origin). The upstream campaign table is kept below. |
| Proposal bridge | `lib/markting/translate.ts`, `lib/markting/bridge.ts`, `lib/markting/runtime.ts`, `lib/markting/repository.ts` | Engine `ProposalView` → fixed tool allowlist + org-scoped alias map → `runtime.registry.call(tool, input)` **without** `pending_operation_id` → `PolicyEngine.validate` → `pending_operations` row + `validated` audit event + `note` provenance event. Then the engine is told the proposal was handled (`/reject`); the bridge has no approve/edit path. Unit conversion per provider: micros (Google, Snapchat, Reddit, sandbox), cents (Meta), float units (TikTok); status vocabularies per provider. |
| Approvals actions | `app/dashboard/approvals/approval-actions.tsx`, `app/api/approvals/[id]/{apply,reject}` | Apply = the exact second call (stored post-parse payload + pending id) through the same registry, so the policy engine re-verifies hash, expiry and policy. Reject consumes the row and writes a `rejected` audit event. Requester ≠ approver unless `MARKTING_ALLOW_SELF_APPROVAL=true`. The page also shows provenance (which engine proposal produced the row). |
| Sandbox provider (demo) | `lib/markting/sandbox-provider.ts` | Credential-free adport provider with the engine's three fixture accounts and eight campaigns, state in `markting_sandbox_state` with compare-and-set. Enabled by `MARKTING_DEMO_MODE=true`; previews still run through the same `PolicyEngine` and Postgres stores, so demo rows appear on the Approvals page and audit log like real ones. `/mcp` and `/api/v1` keep the upstream runtime. |
| Schema | `platform/supabase/migrations/20261002000000_markting_bridge.sql` | `markting_threads`, `markting_account_aliases`, `markting_engine_proposals`, `markting_sandbox_state`; RLS + `adport_backend` grants like the upstream tables. |
| Tests (synthetic only) | `platform/apps/cloud/test/markting-*.test.ts`, `services/engine-demo/tests/test_demo_api.py` | See §2. |

## 2. Verification

| Check | Result |
| --- | --- |
| `pnpm --filter @adport/cloud typecheck` | OK |
| Cloud vitest, no database | 294 passed, 28 skipped (upstream 255 + 39 new) |
| Cloud vitest with local Supabase (new migration applied) | 310 passed, 16 skipped; includes `markting-repository.database.test.ts` |
| New unit tests | translate 20 (every mapped provider's input validated against the real zod schema; hostile fixtures: unknown alias, look-alike tools, platform mismatch, negative/NaN/huge budgets, status injection, prompt-injection prose), bridge 8 (hash-bound pending row, no `applyWrite` at preview, apply with identical args, `PENDING_MISMATCH` on altered args, 25 % cap → `rejected_by_policy`, no `tools:write` → refused, engine hand-off failure tolerated, no `fetch`), engine client 5 (no approve/edit path, token handling, error mapping, file-name validation), sandbox 6 |
| Engine host pytest (`services/engine-demo/tests`) | 7 passed: proposal-only boot, fail-closed assertions, offline analysis turn, change request → `awaiting_approval`, API approve refused (403), reject resumes, reports run/list/download, bad token |
| Engine host run manually | `/health` writes_enabled=false, `/markting/info` write_provider=ProposalOnlyWriteProvider, kill_switch=true, approvers=[] |
| Browser end-to-end (Playwright, standalone build on :3100 + engine host) | sign in → Assistant analysis answer → Arabic budget request → "Change proposed → waiting for approval" card → Approvals row with Source=Assistant → Apply → row gone, sandbox budget 300→240 → audit shows validated / note / applied → Reports: run weekly, PDF downloads as attachment |
| `docker compose config` | valid with a filled `.env` |
| Lint | ruff clean for `services/engine-demo` (engine's rules) |

## 3. Not verified here, and why
- `docker compose up --build` end to end: this sandbox's network policy blocks `deb.debian.org`, so neither the engine image nor the cloud image can be built here. The compose file, both Dockerfiles and the env plumbing are validated statically; the same services were run from source against the same Supabase and Postgres and passed the browser flow above.
- `MARKTING_ENGINE_MODE=live` (real model key): not exercised. Code path is the upstream `serve` runtime with the proposal-only provider; the bridge logic is identical.
- Real provider writes: by design none. Live mode uses the upstream tenant runtime; the translation for Google/Meta/Reddit/Snapchat/TikTok is schema-validated in tests only.

## 4. Known limitations / follow-ups
- Pending previews expire after `pending_ttl_minutes` (default 15). Approvals slower than that need a new proposal.
- The demo engine replays a fixed script: it always proposes `g-103 → 240`. A second proposal after applying shows "240 → 240" (still goes through the gate). Live mode has no such limit.
- Approvals page actions are new UI inside the upstream tree (recorded in `UPSTREAM.md`).
- Threads use one engine `caller_ref`; tenant isolation of conversations lives in `markting_threads`, not in the engine.
- The `infra/` helper scripts need `npm install` inside `infra/` (or the cloud `node_modules`) for `@supabase/supabase-js` and `postgres`.
