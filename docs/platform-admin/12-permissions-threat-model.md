# 12 — Platform Permissions & Threat Model (Proposed)

This is a **proposal**. It is NOT built. It defines a platform-level authorization model **separate** from tenant RBAC.

## Rule 0 — an org owner is NOT a platform operator
Tenant RBAC is `owner/admin/member/viewer` scoped per org (`...cloud_initial_schema.sql:21`). The platform model MUST
be a distinct identity/authorization layer. Never grant platform power by reusing tenant `owner` or the
`adport_backend` service role as a user principal.

## Proposed platform roles
Start minimal; most orgs/operators need only two. Evaluate each against real need:
| Role | Need | Scope |
|---|---|---|
| **SUPER_ADMIN** | Yes | Everything, incl. role assignment, destructive actions (with four-eyes), impersonation approval |
| **PLATFORM_OPERATOR** | Yes | Day-to-day ops: read-all + safe mutations (extend trial, assign plan, toggle flags, freeze writes). No role grants, no destructive deletes |
| **SUPPORT_ADMIN** | Yes | Support triage, customer-health, read-mostly, impersonation (with approval). No billing/security mutations |
| **BILLING_ADMIN** | Defer | Billing/FinOps; fold into PLATFORM_OPERATOR until billing read-models exist (`04`) |
| **SECURITY_ADMIN** | Defer | Security center + audit + kill switch; fold into SUPER_ADMIN initially |
| **READ_ONLY_AUDITOR** | Yes | Read-only everything incl. audit; no mutations — cheap and valuable for compliance |

**Verdict:** ship **SUPER_ADMIN, PLATFORM_OPERATOR, SUPPORT_ADMIN, READ_ONLY_AUDITOR** first; BILLING_ADMIN and
SECURITY_ADMIN are premature until their domains have read-models and controls to govern.

## Authorization design (server-side, defense-in-depth)
- A new table `platform_operators(user_id PK, role, status, created_at, created_by)` — entirely separate from
  `organization_memberships`. Seeded out-of-band (migration/manual), never self-serve.
- A new guard `requirePlatformOperator(minRole)` used by **every** `app/(admin)/**` page and `app/api/admin/**` route,
  independent of `requireDashboardTenant`.
- **Two-layer enforcement**, mirroring the existing posture (`00`): (1) app-code guard on every admin route; (2) a
  dedicated DB role `adport_platform_admin` with RLS policies for cross-tenant reads — so a forgotten app-code filter
  cannot silently leak, and the admin role's reach is itself auditable. (Today `adport_backend` bypasses RLS and
  scoping is app-code-only — acceptable for the tenant app, too risky as the sole guard for a cross-tenant admin.)
- **Audit on every privileged operation** into a new append-only `platform_admin_audit` log (never subject to
  `apply_data_retention`), capturing actor, role, action, target org/user, typed reason, correlation id, before/after.
- **Reason required** for every sensitive/destructive action (stored on the audit row).
- **Optional four-eyes** for destructive actions (org delete, data export, plan override, impersonating a flagged
  customer) — reuse the proven SoD primitive pattern (`store.ts:95-104` requester≠approver) at platform scope.
- **No AI access to admin mutation tools.** The AI gateway is reads/analysis only (`ai-gateway.ts:6-17`); admin
  mutation tools must never be registered in any AI/MCP tool registry.
- **No service-account elevation into platform admin.** Service accounts (`service-account.ts`) must never satisfy
  `requirePlatformOperator`; the guard checks a human `platform_operators` row only.

## Threat model (STRIDE-lite, evidence-anchored)
| Threat | Vector | Mitigation |
|---|---|---|
| **Cross-tenant data leak** | A new admin query forgets `where organization_id` (today the sole guard on the server path — `00`, `lib/db.ts:13`) | Dedicated `adport_platform_admin` RLS role + mandatory code-review/lint rule for cross-org queries; read-only by default |
| **Privilege escalation** | Reusing tenant owner / `adport_backend` / service account as platform admin | Separate `platform_operators` table + guard; never accept tenant role or service account |
| **Silent abuse of power** | Operator reads/mutates customer data without trace | Append-only `platform_admin_audit`, reason-required, retention-exempt |
| **Impersonation abuse** | Operator acts as a customer silently or destructively | Explicit short-lived impersonation w/ banner + immutable start/end events + action restrictions (below) |
| **False safety control** | Admin "freeze writes" built on the unenforced kill switch (GAP-SEC-01, `07`) | Wire + enforce `assertWriteNotKilled` on the live apply path BEFORE exposing any freeze/suspend control |
| **Destructive mistake** | Org/user hard-delete (today owner self-serve cascade, `deletion/route.ts:21`) | Four-eyes + typed reason + staged/soft-delete + export-first |
| **Test backdoor in prod** | `app/api/test/login` enabled via `MARKTING_E2E_TEST_AUTH` | Operationally ensure the flag is never set in prod (`test/login/route.ts:22`); add a startup assertion |

## Impersonation review (recommended, tightly bounded)
Impersonation is **absent today** (grep clean). It is valuable for support but is the highest-risk admin feature.
If built, require ALL of:
- Explicit **typed reason** at start; **short-lived** session (minutes, auto-expiring).
- A persistent, unmistakable **impersonation banner** in the UI at all times.
- **Immutable audit** with distinct **start AND end** events (into `platform_admin_audit`).
- **No silent impersonation** — the impersonated user and the customer org owner are notified/visible.
- **No billing or security-destructive actions while impersonating** (read + ordinary tenant actions only).
- **Optional second approval (four-eyes)** before impersonating a flagged/enterprise customer.
- Built on Supabase admin capabilities (`createAdminClient()` is already used narrowly for `inviteUserByEmail`,
  `tenant-admin.ts:53`) but via a dedicated, scoped, time-boxed token path — never the raw service role in the browser.

## Non-negotiables preserved
Phase-0 invariants stay intact: no autonomous writes, Mode-B HELD, AI cannot write (`00`, `05`). The admin layer adds
**no** AI write capability and must not relax any runtime-mode gate.
