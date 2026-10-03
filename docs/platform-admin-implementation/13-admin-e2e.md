# 13 — Admin E2E (READY, WAVE 27)
`e2e/admin.spec.ts` + the operator storage-state setup prove, in a real browser against seeded Supabase:
- @operator (SUPER_ADMIN): `/admin` plane + Organizations/Users/Security surfaces render.
- @owner-denied (buyer = tenant OWNER, not an operator): `/admin` shows no admin chrome (server guard → notFound).
- @public (unauthenticated): `/admin` denied.
Routed via Playwright projects (admin-setup/admin, authed, public). Complemented by the DB-level authz test.
Remaining E2E (support impersonation flow, read-only-auditor mutation-denied, service-account-denied) are PARTIAL /
deferred with impersonation.
