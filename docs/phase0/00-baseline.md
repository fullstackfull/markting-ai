# Phase 0 — Baseline (re-verification before implementation)

This document is written **before any Phase 0 code change**. It re-verifies the approved audit's
Phase 0 findings against the source at the current HEAD, records the current test baseline and the
as-built write architecture, lists audit findings that no longer apply, and records newly discovered
blockers. Line numbers are re-checked here; do not trust the audit's line numbers where HEAD has moved.

## Identity

| Field | Value |
|---|---|
| Repository | `fullstackfull/markting-ai` |
| Branch | `claude/amazing-heisenberg-0unnak` |
| HEAD at baseline | `3205f20` (`3205f2002df47f126f42a6e47e1f65baaed66a56`) |
| Audit baseline HEAD | `2e68a7f` (audit documents under `docs/audit/`, approved) |
| `engine/` vendored import | `4162146` — byte-identical (`git diff --stat 4162146 HEAD -- engine/` → empty) |
| Date | 2026-10-03 |

## Current test baseline (captured at HEAD, before changes)

| Suite | Command | Result |
|---|---|---|
| core | `pnpm --filter @adport/core test` | 41 passed |
| provider-meta | `pnpm --filter @adport/provider-meta test` | 23 passed |
| markting glue + policy bridge | `ADPORT_RUN_DATABASE_TESTS=0 vitest run test/markting-*.test.ts` | 45 passed (5 files) |

The core policy-engine suite (`platform/packages/core/test/policy-engine.test.ts`) covers validate, apply,
expiry, mismatch, and **sequential** single-use reuse — but has **no concurrency test** (confirms R0-01's
"no such test exists today"). Docker and the local Supabase stack are **down** in this sandbox after a
container restart, so DB-gated suites (`*.database.test.ts`, `database.integration.test.ts`) cannot run
here; they are the CI lane that R0-10 (P0-E) must stand up. In-sandbox, R0-01 atomicity is proven at the
engine-orchestration level against an atomic in-memory store; the Postgres compare-and-set is proven by a
DB-gated test that runs in CI.

## As-built write architecture (verified at HEAD)

One sanctioned mutation path exists and the single-writer property holds: only
`platform/packages/core/src/policy/engine.ts:113` (`provider.applyWrite`) reaches a real provider write,
and the engine host swaps in a proposal-only provider behind a fail-closed boot
(`services/engine-demo/serve_demo.py`). The two-step contract is: `guardedWriteTool` handler
(`platform/packages/core/src/tools/write.ts:39-66`) calls `ctx.engine.validate` (no `pending_operation_id`,
preview only) or `ctx.engine.apply` (with id). Three surfaces reach this handler:

- **Dashboard apply** — `app/api/approvals/[id]/apply/route.ts` → `applyPending` (`lib/markting/bridge.ts:119`)
  → `registry.call(tool, {...payload, pending_operation_id})` → `write.ts` → `engine.apply`.
- **REST** — `app/api/v1/tools/[tool]/route.ts:13` → `createTenantRuntime(apiPrincipal)` →
  `registry.call(tool, input)` (input may carry `pending_operation_id`).
- **MCP (cloud)** — `app/mcp/route.ts:14` → `createTenantRuntime(apiPrincipal)` →
  `@adport/mcp` → `registry.call` (`packages/mcp/src/index.ts:169`).

`ctx.engine.validate`/`ctx.engine.apply` have exactly one caller: `write.ts`. This is the single seam
through which the actor/approval model (R0-02) can be injected so every surface inherits it.

## Phase 0 findings re-verified against code at HEAD

Status legend: **CONFIRMED** (defect reproduced at HEAD, cited), **MOVED** (true but line shifted),
**NOT-APPLICABLE** (audit claim does not hold at HEAD).

### P0-A scope (write-path safety): R0-01, R0-02, R0-03, R0-05, R0-06

| Item | Audit claim | Re-verification at HEAD | Status |
|---|---|---|---|
| **R0-01** | apply = get → applyWrite → audit → delete, no CAS/transaction/idempotency | `engine.ts:87-125` is exactly get(`:90`)→`applyWrite`(`:113`)→`audit.append('applied')`(`:114`)→`delete`(`:123`), no transaction. `PostgresPendingStore.delete` (`repository.ts:413-418`) is `update … set consumed_at = now() where id=… and organization_id=…` — **no `and consumed_at is null`, no `returning`, no `for update` in `get`** (`:385-412`). | **CONFIRMED** |
| **R0-02** | four-eyes only in dashboard route, skipped when `created_by` null; REST/MCP apply with only a scope check | Dashboard route enforces role + self-approval only (`apply/route.ts:19,22`), and the self-approval guard is `row.createdBy && row.createdBy === principal.userId && …` — **skipped entirely when `createdBy` is null** (`:22`). REST (`v1/tools/[tool]/route.ts:11-13`) and MCP (`app/mcp/route.ts`) call `registry.call` → `write.ts:64` `engine.apply` with **no approver check at all**. `apiPrincipal` has no `userId` (`auth.ts:22-37`). | **CONFIRMED** |
| **R0-03** | generic `*_api_update/remove` make uncapped status/targeting/destructive changes; only `/budget/i` policed | Meta `planApiUpdate` (`meta/src/provider.ts:372-391`) rejects only budget fields (`containsMetaBudget`) and asserts ownership, but passes arbitrary non-budget fields (status/targeting) through with empty `budgetDeltas`. `planApiDelete` (`:393-406`) is destructive. `api_create` **is** coerced PAUSED + budget-checked (`:343-370`) — confirms the hole is update/remove, not create. Same generic tools exist on google/tiktok/apple/microsoft/reddit. No central risk classifier on the adport write path. | **CONFIRMED** |
| **R0-05** | typed Meta writes skip `assertObjectOwnedByAccount`; only generic path asserts | `planSetBudget` (`:503-535`), `planSetLifetimeBudget` (`:319-341`), `planSetStatus` (`:478-500`) call `client.get`/`client.post` on the supplied `object_id`/`campaign_id`/`ad_set_id` with **no ownership assertion**; only `planApiUpdate:379` and `planApiDelete:394` call `assertObjectOwnedByAccount` (`:408-414`). | **CONFIRMED** |
| **R0-06** | budget caps enforced at validate only; apply re-runs just `checkStaticPolicy` | `engine.apply` calls only `checkStaticPolicy` (`:111`); `checkBudgetPolicy` runs only in `validate` (`:62`). Apply returns the **stored** preview (`:124`) with no re-preview/reconciliation (also SEC-17). | **CONFIRMED** |

### Supporting facts for the actor model (R0-02)

- `TenantPrincipal` (`lib/cloud/types.ts:1-16`) carries `organizationId`, optional `userId`, `apiKeyId`,
  `oauthTokenId`, `clientId`, `role`, `scopes`. `sessionPrincipal` sets `userId` (human); `apiPrincipal`
  sets `apiKeyId` **or** `oauthTokenId`, never `userId` — the clean human/non-human line.
- `pending_operations` (`supabase/migrations/20260817171039_cloud_initial_schema.sql:130-148`) has
  `created_by uuid references auth.users(id) on delete set null`, `consumed_at timestamptz`, and no state
  column, no actor-type, no idempotency/claim column. `audit_events` (`:150-168`) has an `event` CHECK that
  does **not** include an `applying` intent event — the Phase-0 migration must widen it.

## Audit findings that no longer apply / are already handled

- None of the P0-A findings were already fixed; all five CONFIRMED at HEAD.
- The engine `/reject`/`/edit` authz gap (SEC-09) is **mitigated in the markting product** (single
  `adport-bridge` caller + `FORBIDDEN_PATHS`), as the audit itself notes — it is not P0-A scope and is not
  reopened here.
- `api_create` being "uncapped" (an earlier C7-02 framing) is **NOT-APPLICABLE**: create is coerced PAUSED
  and budget-checked at HEAD (`meta/src/provider.ts:343-370`). R0-03 is therefore scoped to update/remove
  (and destructive classification), per the roadmap's own correction.

## Newly discovered facts / blockers (not in the audit, found during re-verification)

1. **`engine.validate`/`engine.apply` have a single caller (`write.ts`).** Good news: the actor/approval
   model can be injected at one seam (`ToolContext`) and every surface inherits it. No per-provider change
   is needed for R0-01/R0-02/R0-06.
2. **The file-backed `PendingStore` (`core/src/policy/pending.ts`) cannot offer true cross-process CAS.**
   It is the local-CLI/standalone-MCP store. The atomic claim guarantee for R0-01 must live in
   `PostgresPendingStore` (SQL `UPDATE … WHERE state='pending' … RETURNING`). The core store will implement
   a best-effort single-writer claim and this limitation will be documented in code.
3. **`db()` is a `postgres` client that supports `db().begin(...)`** (`lib/db.ts`), so a transactional
   claim+intent-audit is available for the cloud store.
4. **Docker/Supabase are down in this sandbox.** DB-gated concurrency/authz tests are the CI lane (R0-10,
   P0-E). In-sandbox P0-A proves engine orchestration against an atomic in-memory store and the SQL CAS is
   added as a DB-gated test that runs in CI.
5. **`audit_events.event` CHECK constraint** must be widened (forward-only migration) to admit an
   `applying` intent event for SEC-08 completeness; otherwise the pre-write intent row cannot be inserted.

## P0-A implementation plan (to be executed next, then STOP)

1. **Actor model (core):** add `ApplyActor` (`human_user|service|ai_agent|api_client|system_job`), thread a
   requester (validate) and approver (apply) through the single `write.ts` seam via `ToolContext.writeActor`
   + `allowSelfApproval`. Enforce in `PolicyEngine.apply`: approver must be a human with an id
   (`APPROVAL_REQUIRED`), requester≠approver unless self-approval is explicitly allowed
   (`SELF_APPROVAL_FORBIDDEN`). Persist requester/approver on the pending row. (R0-02)
2. **Atomic + idempotent apply (core + cloud + migration):** replace `get`+`delete` with an atomic
   `claim(id, approver)` (`PENDING → APPLYING`), then `applyWrite`, then `markApplied`/`markFailed`
   (`→ APPLIED|FAILED`). Postgres `claim` = `UPDATE … SET state='applying', consumed_at=now() … WHERE
   state='pending' AND consumed_at IS NULL AND expires_at>now() RETURNING …`. A row stuck in `applying`
   (crash after claim) is **indeterminate and not auto-retried** (fails closed). Pre-write `applying` intent
   audit row for SEC-08. The pending id is the idempotency identity; a replayed apply gets
   `PENDING_NOT_FOUND`/already-applied. (R0-01, SEC-02, SEC-08)
3. **Apply-time revalidation + immutable preview (core):** at apply, re-preview against live state, re-run
   `checkStaticPolicy` **and** `checkBudgetPolicy`, and compare a `preview_digest` of the approved preview to
   the fresh one; on material divergence, mark `superseded` and throw `REPREVIEW_REQUIRED` (never apply a
   stale preview). (R0-06, SEC-07, SEC-17, immutable-preview requirement)
4. **Risk classifier + generic-tool gate (core):** add `classifyWriteRisk(op)`; gate generic
   `*_api_(create|update|delete|remove)` tools fail-closed on the sanctioned path unless a default-off policy
   flag opts them in; record risk class in the audit. (R0-03)
5. **Object ownership on typed writes (meta provider):** call `assertObjectOwnedByAccount` in `planSetBudget`,
   `planSetLifetimeBudget`, `planSetStatus` before any provider mutation. (R0-05)
6. **Tests (test-first for each defect):** concurrency (two parallel applies → one write), replay, retry,
   expired, already-applied, self-approval blocked for null/same-requester, REST/MCP apply blocked
   (non-human approver), generic-tool gate, typed-write ownership, apply-time cap re-check, re-preview on
   drift. DB-level CAS as a DB-gated CI test.

Nothing in P0-A enables live writes, lifts the fixture-only default, or binds an alias to a real account.
