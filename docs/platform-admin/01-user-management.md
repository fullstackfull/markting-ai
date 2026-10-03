# 01 — User Management (Discovery)

**Question:** what can a PLATFORM owner/operator do with users today? **Answer: almost nothing cross-tenant.** User
management exists only *within* an org, exercised by a tenant owner/admin.

Relevant tables: `public.profiles` (`20260817171039_cloud_initial_schema.sql:17-22`), `auth.users`
(Supabase-managed), `public.organization_memberships` (`:35-44`), `public.api_keys` (`:110-123`),
`public.deletion_requests` (`:184-192`), `public.markting_service_accounts`
(`20261011000000_phase7_governance.sql:84-97`). **There is no `sessions` table** — auth sessions live inside Supabase
GoTrue and are not modeled.

## Capability matrix (platform-operator lens)
| Capability | Status | Evidence |
|---|---|---|
| List every user across the SaaS | **MISSING** | No query selects `auth.users`/`profiles` without an org filter; only directory is `private.organization_member_directory(org_id)` (`...cloud_initial_schema.sql:353-366`), org-scoped |
| Search / filter users | **MISSING** (narrow lookup only) | `private.find_auth_user_id(email)` resolves one exact email (`:343-351`), used only to add a member (`lib/cloud/tenant-admin.ts:47-49`) |
| Inspect a user profile | **TENANT-SCOPED** | `profiles_select_self` → own profile only (`:255-256`); within-org members via `listOrganizationMembers` (`tenant-admin.ts:20-24`) |
| See which orgs a user belongs to | **SELF only** | `memberships_select_self` (`:261-262`); no "all orgs for user X" path |
| Inspect roles | **TENANT-SCOPED** | per-member role via `listOrganizationMembers` (`tenant-admin.ts:20-24`) |
| Suspend / reactivate a user | **MISSING** | no status column on profiles/membership, no suspend path |
| Revoke sessions | **MISSING** | no sessions table; only self sign-out (`app/dashboard/actions.ts:6-8`) |
| Revoke API keys | **EXISTS (tenant owner/admin)** | `revokeApiKey` org-scoped (`repository.ts:339-356`); routes `app/api/api-keys/[id]/route.ts`, list `app/api/api-keys/route.ts:14-32` (owner/admin gate `:18`) |
| Revoke service accounts | **BACKEND-ONLY / UNWIRED** | table `markting_service_accounts` + helpers `mintServiceKey`/`authenticateServiceKey` (`lib/markting/ops/service-account.ts:29,40`); no store fn, no route — referenced only in tests |
| See last login | **MISSING** | `last_sign_in` never queried; API keys expose `last_used_at` (`:121`) but that is key usage, not user login |
| See security events | **PARTIAL / TENANT-SCOPED** | `audit_events` per-org (`:150-176`) via `listAuditEvents(org)` (`repository.ts:811-818`); captures member/key/settings/apply events, **not** auth/login events; no cross-org feed |
| See usage (AI requests) | **BACKEND-ONLY** | `markting_ai_usage` (`20261004000000_phase1_ai_usage.sql:5-25`); `usageSince` used only for quota (`ai-gateway.ts:79`), never surfaced |
| See AI cost | **BACKEND-ONLY** | `estimated_cost_micros` (`...phase1_ai_usage.sql:21`); governance page renders no live numbers (`app/dashboard/governance/page.tsx:51-58`) |
| See billing relationship | **TENANT-SCOPED** | `organization_subscriptions` per-org (`20260828120000...:3-15`) |
| Merge duplicate identities | **MISSING** | no code path |
| Delete a user | **PARTIAL / self-triggered** | `app/api/deletion/route.ts:11-29`: owner deletes their **own org** (cascade); the caller's own auth user is deleted only if they have no remaining memberships (`:22-25`). An operator cannot delete an arbitrary user |
| Deletion/anonymization machinery | **Partially vestigial** | `deletion_requests` + `deletion_status` enum exist (`:15,184-192`) and `apply_data_retention` purges old request rows (`:393-396`), but the live route writes a `deletion_requested` audit event then hard-deletes — it never inserts a `deletion_requests` row, and no anonymization logic exists (grep "anonymiz" → none) |
| Export user data | **MISSING** | no export route |
| Impersonate a user | **MISSING** | grep "impersonat" → none; `createAdminClient()` used only for `inviteUserByEmail` (`tenant-admin.ts:53`) |

## Tenant-admin user management that DOES work (for contrast)
Invite / change-role / remove members, all owner/admin-gated, last-owner-protected, and audited
(`tenant-admin.ts:26-146`; routes `app/api/members/route.ts:15-58`). This is solid — but it is TENANT_ADMIN, usable
only inside one's own org, never across tenants. See `02`.

## Net
Of ~19 operator user-management capabilities, **1** exists at tenant scope (revoke own-org API keys), a handful are
BACKEND-ONLY (usage/cost/security data captured but not surfaced cross-tenant), and the rest — list/search all users,
suspend, revoke sessions, last login, impersonate, export, merge — are **MISSING**. A platform User-management console
is greenfield (see `13` GAP-USR-*, `14`).
