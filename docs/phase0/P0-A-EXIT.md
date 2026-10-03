# P0-A Exit — Write-path safety

Scope: R0-01, R0-02, R0-03, R0-05, R0-06, and the P0-A close (all-provider ownership, entry-point
convergence, applyWrite-bypass search, PendingStore multi-process guard). Status: **COMPLETE**.

## One write path — proven
Every sanctioned mutation converges on `PolicyEngine.apply` (`platform/packages/core/src/policy/engine.ts`).
`grep -rn applyWrite` over platform/ returns exactly two callers: `PolicyEngine.apply` (the seam) and
`AccountScopedProvider.applyWrite` (the decorator the engine itself calls after an account-allowlist
check). Every other `applyWrite` is a provider method reached only through the engine. No bypass exists.

Write entry points all funnel through `registry.call → guardedWriteTool → PolicyEngine`:
- REST `app/api/v1/tools/[tool]/route.ts` (api_client actor → preview only, cannot self-apply).
- MCP `app/mcp/route.ts` (api_client actor).
- Dashboard apply `app/api/approvals/[id]/apply/route.ts` → `applyPending` (human approver).
- Assistant `lib/markting/assistant.ts` → `bridgeProposal` → validate only (ai_agent requester).
- `recommendation_apply` tool and the demo/sandbox runtime — same seam.

## R0-01 atomic + idempotent apply
`apply()` peeks, then atomically claims (`PENDING→APPLYING`) via `PostgresPendingStore.claim`
(`UPDATE … WHERE state in ('pending','failed') AND expires_at>now() RETURNING`), re-previews,
writes, then marks `APPLIED`/`FAILED`. Two concurrent applies → exactly one `applyWrite`. A retried
apply after success returns the stored result (idempotent no-op). A provider throw marks `FAILED`
(indeterminate) with a pre-write `applying` intent audit row; it is never silently re-executed. The
file-backed `PendingStore` is single-writer and documents that cross-process atomicity lives only in
the Postgres store.

## R0-02 human approval + four-eyes on every surface
`ApplyActor` (human_user/service/ai_agent/api_client/system_job) is threaded through `ToolContext`.
`apply` requires a human approver with an id (`APPROVAL_REQUIRED`) distinct from the requester
(`SELF_APPROVAL_FORBIDDEN` unless explicitly allowed). The old null-`created_by` self-approval
exemption (SEC-26) is closed by moving the check into the engine seam. REST/MCP api_clients can
preview but never apply.

## R0-03 generic-tool gate
`classifyWriteRisk` + `checkToolPolicy` fail closed on `*_api_(create|update|delete|remove)` unless
`policy.allow_generic_api_writes` (default false). This neutralizes the Apple generic
api_update/delete OWNERSHIP_MISSING gap and any untyped passthrough.

## R0-05 object ownership on typed writes — all providers
Audited every provider's typed writes. Ownership is enforced before mutation on: meta (GET
`?fields=account_id`), google (account-scoped resource names + GAQL lookups), snapchat/linkedin/
pinterest/reddit/spotify (account-scoped GET), microsoft (account-scoped lookup + scope header),
tiktok (advertiser-scoped lookup — hardened in P0-A close to reject a foreign id before mutating),
apple (account-scoped GET on typed writes), x (account-scoped `getCampaign`). Apple generic
api_update/delete and dismiss_recommendations lack an in-code assert but are fail-closed by the
generic gate (update/delete) or are non-spend (dismiss). Meta regression test covers cross-account
rejection; tiktok regression added.

## R0-06 apply-time revalidation + immutable preview
`apply` re-runs static + budget policy against a FRESH preview and compares a `previewDigest` of the
approved preview; on divergence it marks `superseded` and throws `REPREVIEW_REQUIRED`. A pending that
passed validate under looser live state cannot apply a stale effect.

## Tests
core policy-engine-phase0 (concurrency, four-eyes, generic gate, apply-time recheck, re-preview);
meta ownership; tiktok foreign-id; idempotent-replay semantics across core/snapchat/spotify/bridge.
DB-level atomic claim proven by `apps/cloud/test/pending-claim.database.test.ts` (runs in CI).

## Known limitations
- Provider APIs without native idempotency tokens cannot be made exactly-once on the provider side;
  the pending id is the local idempotency identity and the claim prevents a second local dispatch. A
  row stuck in `applying` (crash after the provider call) is indeterminate and not auto-retried.
- A `failed` row is re-claimable at the store level but is not surfaced in the dashboard approvals
  list (it is consumed), so recovery is an operator action.
