# 04 — RBAC / ABAC & Enterprise Identity (7I/7J/7S)

## Roles & permissions (`ops/rbac.ts`)

Roles: OWNER, ADMIN, MEDIA_BUYER, ANALYST, APPROVER, VIEWER, AGENCY_ADMIN, CLIENT_ADMIN. Permissions
(view_account, view_commerce, use_ai, create_recommendation, request_preview, approve,
execute_approved_operation, manage_policies, manage_secrets, manage_billing, manage_members,
emergency_lock) are enforced SERVER-SIDE.

## Segregation of duties (hard invariants)

Requester ≠ approver; an ANALYST cannot execute; the AI/model can neither approve nor execute (it may
only analyze/propose); a SERVICE ACCOUNT can never satisfy a human approval; holding `manage_billing`
never implies ad-write (`billingAdminHasAdWrite` is false for billing-only roles).

## Service accounts (7S) — `ops/service-account.ts`

Scopes, expiration, rotation, revocation, audit, last-used. Keys are stored only as a sha256 hash;
the plaintext is shown once. Authentication fails closed (NOT_FOUND / REVOKED / EXPIRED / OUT_OF_SCOPE).

## SSO / enterprise identity (7J) — design

SAML/OIDC, enforced SSO, domain restrictions, session controls, MFA, and future SCIM are DOCUMENTED as
the enterprise-auth architecture. They are NOT claimed as implemented — SSO is a documented foundation,
not a shipped feature, in this environment.
