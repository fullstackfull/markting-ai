# 00 — Current State: Admin & Platform-Operations Capability (Discovery)

**Repo:** `fullstackfull/markting-ai` · **Branch:** `claude/amazing-heisenberg-0unnak` · app `platform/apps/cloud`.
**Method:** direct read of every `app/dashboard/*/page.tsx`, every `app/api/**/route.ts`, the auth/runtime libs, and all
21 SQL migrations. Six parallel evidence sweeps + independent verification of the authorization core. Every claim in
this set carries `file:line`. **This mission is DISCOVERY ONLY — no `/admin` was built.**

## The one-sentence answer
MARKTING-AI today is a **single-tenant SaaS application with a mature TENANT-level admin, and NO platform/super-admin
of any kind** — no `/admin` surface, no cross-tenant role, flag, table, or query path reachable by any user.

## Does a true Super Admin exist? — NO (definitive)
- No `app/admin` directory; the only app route groups are `dashboard, api, auth, login, oauth, onboarding, mcp, account-selection, page.tsx` (`app/` listing).
- The only role type is the Postgres enum `public.organization_role = ('owner','admin','member','viewer')`
  (`platform/supabase/migrations/20260817171039_cloud_initial_schema.sql:21`; TS mirror `lib/cloud/types.ts:7`).
  There is **no** `is_platform_admin` / `is_staff` / `is_superuser` column, staff table, or global role.
- The only "Super Admin" string in the whole tree is unrelated Microsoft-Ads CLI help text
  (`platform/packages/cli/src/connect/microsoft.ts:27`).
- Every principal is tenant-bound: `sessionPrincipal` / `apiPrincipal` always carry one `organizationId`
  (`lib/cloud/auth.ts:9,22`); `requireDashboardTenant` resolves exactly one org per request
  (`lib/cloud/dashboard.ts:23-54`). All 25 dashboard pages call it; **0** call any operator guard.
- `adport_backend` (the app's DB role) is `nologin noinherit` — a service role for the process, not a user principal
  (`...cloud_initial_schema.sql:5-11`).

## What IS tenant-admin (real, reachable, audited)
`lib/cloud/tenant-admin.ts` is a genuine org-scoped admin module: `requireMemberAdmin` → owner/admin
(`:11-13`), owner-only to grant `admin` (`:15-18`), last-owner protection (`:102,133`), **every mutation writes an
`audit_events` row** (`:68-76,108-113,139-144,158-163,187-193`), all filtered by `principal.organizationId`.
Tenant owners/admins can manage members, API keys, connections, ad-account activation, policy/retention, and billing
(owner-only). See `02`, `07`.

## What tenant-admin is NOT
An organization owner is **not** a platform operator. There is no cross-tenant visibility of users, orgs, revenue, AI
cost, provider/commerce health, jobs, or security events. The SaaS owner cannot, today, answer "how many orgs exist",
"what is MRR", "which connections are expired across the fleet", or "suspend org X" through any product surface.

## Authorization mechanism (verified)
- **Org isolation is enforced by explicit `where organization_id = ${principal.organizationId}` filters in
  application code**, not by RLS on the server path: `lib/db.ts:7-18` connects as `adport_backend`, whose per-table
  policies are `for all to adport_backend using(true) with check(true)` (`...cloud_initial_schema.sql:319-327`) — i.e.
  the server role bypasses RLS. The validated `organizationId` always originates from a membership lookup
  (`resolveMembership`, `lib/cloud/repository.ts:33-52`), so cross-tenant access is sound **as long as code filters by
  it** (it consistently does).
- RLS **does** protect the browser/PostgREST path (membership-scoped SELECT policies, deny-all on secret tables,
  `revoke … from anon, authenticated`) — `...cloud_initial_schema.sql:261-341`; a prior cross-tenant PostgREST gap on
  two tables was closed in `20261012000000_phase1_rls_fixup.sql`.
- Middleware `proxy.ts` only refreshes the Supabase session cookie (`lib/supabase/proxy.ts:5-23`); it performs **no**
  route authorization — each handler guards itself (they do).

## Phase-0 safety invariants — CONFIRMED enforced
- **No autonomous writes:** `RuntimeMode` has no autonomous-write member (`lib/markting/runtime-mode.ts:5-24`);
  `assertApplyAllowed` fails closed (`:57-65`); capability matrix never grants autonomous apply (`lib/markting/ops/mode-a.ts:26-34`).
- **Mode-B HELD:** safe live default is `LIVE_WRITE_DISABLED` (`runtime-mode.ts:14,30,37`); the live apply route gates
  on `assertApplyAllowed()` and fails closed (`app/api/approvals/[id]/apply/route.ts:23`); `providerWritesPossible()`
  is false in all Mode-A live modes (`mode-a.ts:52-55`).

## Headline P0 (latent, not actively exploitable) — carried into the gap register
The Phase-7 governance layer (kill switches, operations ledger, SoD approvals, provider-health, change records) is
fully implemented in `lib/markting/ops/store.ts` + `20261011000000_phase7_governance.sql` **but has no callers outside
`lib/markting/ops/*` and `test/`.** In particular the live apply path **never calls `assertWriteNotKilled`**
(`app/api/approvals/[id]/apply/route.ts:30-31` vs the guard at `lib/markting/ops/store.ts:138-145`), while the
governance page advertises kill switches as working (`app/dashboard/governance/page.tsx:60-63`). This is **not
exploitable today** because `assertApplyAllowed()` already blocks live writes in the held posture — but it is a **P0
prerequisite** that MUST be wired before Mode-B exit or before any admin "freeze-writes / suspend-org" control is built
on the kill switch. Documented, not fixed (discovery-only). See `07`, `13` (GAP-SEC-01).

## Document index
| Doc | Area |
|---|---|
| 00 | This current-state summary |
| 01 | User management |
| 02 | Organizations / customers |
| 03 | Plans & entitlements |
| 04 | Billing / revenue |
| 05 | AI operations |
| 06 | Provider & commerce health |
| 07 | Security & global audit |
| 08 | System operations (jobs/queues) |
| 09 | Support & customer success |
| 10 | Feature flags & rollouts |
| 11 | Admin UX / information architecture |
| 12 | Platform permissions & threat model |
| 13 | Gap register (P0–P3) |
| 14 | Implementation roadmap |
| 15 | Final council |
