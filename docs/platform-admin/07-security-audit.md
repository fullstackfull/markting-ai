# 07 — Security Center & Global Audit (Discovery)

## Security primitives that EXIST (and are sound)
- **API keys:** peppered HMAC-SHA256 `digestApiKey` (`lib/crypto.ts:33-34`, pepper `lib/env.ts:12` min 32 chars);
  stored `repository.ts:306`, looked up by deterministic HMAC `:330`. Create/revoke owner/admin + audited
  (`repository.ts:311-315,348-352`).
- **MCP OAuth** (`20260825120000_mcp_oauth.sql`, `lib/cloud/mcp-oauth-repository.ts`): PKCE S256 (`:206`), single-use
  auth codes with `for update` + consumed_at (`:199-210`), refresh-token rotation with 60s reuse grace (`:238-255`),
  scope-narrowing enforced (`:249`), signed-JWT access tokens verified + DB-checked with full claim equality
  (`:287-289`), idempotent revocation (`:300-317`). Token values stored as sha256 digest. Solid.
- **Credential rotation:** `for update` lock + optimistic grant-match that fails closed on concurrent refresh
  (`credential-rotation.ts:28-34`), AAD-bound AES. Sound.
- **Phase-0 write safety** (`20261003000000_phase0_write_safety.sql`): pending-operations state machine (`:5-18`),
  atomic-claim partial index (`:26-28`), `applying` intent audit event (`:32-39`). Wired into the live apply path.
- **SoD / four-eyes:** `markting_operation_approvals` one-approval-per-actor (`20261011000000...:46-54`);
  `recordApproval` enforces requester≠approver and forbids model/service-account approvers (`store.ts:95-104`). The
  **live** apply route enforces four-eyes via the policy-engine seam (`app/api/approvals/[id]/apply/route.ts:26-31`,
  comment SEC-26), so REST/MCP/dashboard all inherit it.

## Known weaknesses (not currently exploitable)
- **Service accounts** (`markting_service_accounts` `20261011000000...:84-97`): `service-account.ts:29,40` use
  **unsalted SHA-256 + non-constant-time `!==`** — weaker than the api_keys path. Mitigated only because the feature
  is entirely **unwired** (no route mints/verifies them). Must be fixed before any admin wires service accounts.
- **Retention policy/impl disagreement:** `lib/markting/retention.ts:32` declares `audit_events` immutable/never
  deleted, but `private.apply_data_retention()` **does** delete `audit_events` past the org window
  (`...cloud_initial_schema.sql:382-385`). A compliance footgun to reconcile. See `08`.

## P0 (latent) — governance controls not enforced on the live write path · GAP-SEC-01
The Phase-7 governance layer (kill switches, operations ledger, provider health, change records, reconciliation) is
implemented in `lib/markting/ops/store.ts` + `20261011000000_phase7_governance.sql` but has **no callers outside
`lib/markting/ops/*` and `test/`**. Specifically the live provider-write path
`app/api/approvals/[id]/apply/route.ts:30-31` never calls `assertWriteNotKilled` (guard defined
`store.ts:138-145`), while the governance page advertises kill switches as working
(`app/dashboard/governance/page.tsx:60-63`). **Not exploitable today** (writes are already blocked by
`assertApplyAllowed()` fail-closed, `apply/route.ts:23`, and Mode-B is HELD), but it is a **P0 prerequisite** before
Mode-B exit or any admin "freeze-writes/suspend-org" control. Documented, not fixed (discovery-only).

## Global audit — today TENANT-ONLY
- `audit_events` (`20260817171039...:150-176`, enum extended `20261003000000...:32-39`) is strictly per-org, read via
  `listAuditEvents(org, 150)` on `app/dashboard/audit/page.tsx:12-14`, RLS `audit_events_select_member` (`:305-310`).
- **No filters** in the UI (no user/event/actor/date filter), fixed 150-row cap, no pagination.
- **Audited actions:** provider op lifecycle (validated/applying/applied/rejected/note), connection connect/revoke,
  API-key create/revoke, member invite/role/remove, settings/rename, deletion_requested, account_access, subscription.
- **NOT audited:** logins/auth events (Supabase-managed, never mirrored), data exports/reads, MCP OAuth grant/exchange/
  revoke (write only to `private.mcp_oauth_*`), rate-limit denials, kill-switch/governance changes (`markting_change_
  records` exists but is never written).

## Platform-wide security view — MISSING
No failed-login / suspicious-login view, no cross-tenant-denial log, no webhook-failure monitor, no forced session
revocation (no sessions table), no credential-rotation/KMS-version dashboard, no security-alert feed. The only
cross-cutting "security" artifacts are per-org `audit_events` and the dormant governance tables.

## What a platform admin audit SHOULD support (gap)
A global audit must support filters by user, org, provider, action/event, service account, tool, severity, date, and a
request/correlation id. **Correlation ids are not propagated through HTTP today** (a `traceId` column exists on
`markting_operations` and a span field, but nothing wires it end-to-end — see `08`). Building global audit also
requires either (a) mirroring Supabase auth events into an append-only platform log, or (b) reading GoTrue's
`auth.audit_log_entries`, plus a careful, read-only, append-only cross-tenant query model.

## Implications
A platform Security Center + Global Audit is **greenfield**, and GAP-SEC-01 (wire + enforce the kill switch / write
guard) is the single most important prerequisite — an admin "freeze writes" built on an unenforced switch would be a
false safety control. See `13`, `14`.
