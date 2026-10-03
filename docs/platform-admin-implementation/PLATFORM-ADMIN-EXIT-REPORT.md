# Platform Admin — Exit Report

## Verdict
A **safe, CI-verified platform-admin foundation** is in place: the one P0 safety gap is closed and enforced, a
genuinely separate platform identity/authorization plane exists, and a read-first operator slice (Overview,
Organizations, Users, Security, Governance) plus two fully-backed audited mutations (per-org freeze, GLOBAL kill) are
live behind a server-side guard. The remaining operator surfaces are honest PARTIAL stubs (no fabricated data) with a
clear roadmap. This is **not** a complete 35-wave product; the capability matrix (`15`) and this report say exactly
what is READY vs PARTIAL vs DEFERRED.

## What shipped (READY)
- **P0 GAP-SEC-01 closed & enforced** — kill switch fails closed on the real provider-apply seam (all 5 scopes),
  proven on real Postgres. Service-account hashing hardened; MCP token purge scheduled.
- **Platform identity** — `platform_operators` roster (authority never from org membership), four roles, guards,
  SELECT-only `adport_platform_admin` cross-tenant read role, append-only `platform_admin_audit`.
- **Admin plane** — `/admin` shell (distinct chrome, server-guarded → `notFound` for non-operators), Overview
  (cross-tenant KPIs, NOT_AVAILABLE where unsupported), Organizations (list+detail), Users (list+detail), Security &
  Audit (posture + active kill switches + platform audit feed), Governance (GLOBAL kill switch, SUPER_ADMIN only).
- **Mutations** (reason-required, role-gated, audited, built on the enforced kill switch): per-org freeze/unfreeze
  writes; GLOBAL kill switch.
- **Tests** — real-Postgres: kill-switch enforcement, platform authz/isolation, service-account hashing; browser E2E:
  operator access vs tenant-owner/anonymous denial.

## Remaining P1 (highest-value, not yet built)
Plans DB catalog + per-org entitlement overrides; billing revenue read-model (MRR/ARR) + failed-payment pipeline;
AI fleet cost + per-org quota/disable; provider fleet health read-model; commerce fleet health; jobs runner + system
view; unified global audit (tenant+provider+billing) with rich filters; overview KPIs that depend on these.

## Remaining P2 / P3
Refunds/credits + invoices + tax/VAT/SAR; model routing/disable controls; proactive token-expiry sweep + webhook/
sync failure rollups; session revocation / user suspend / export; support triage + customer-health; DB-backed feature
flags; platform settings; data-quality fleet; admin notifications; unified global search; merge-identities. (Full
enumeration and dependencies in docs/platform-admin/13-gap-register.md.)

## Deferred (with rationale)
- **Impersonation** — deliberately NOT built. It is the highest-risk admin feature and requires the bounded design in
  docs/platform-admin/12 (explicit reason, short-lived session, persistent banner, immutable start/end audit, no
  destructive/billing/security/provider-write actions while impersonating, optional four-eyes). No silent-login
  primitive was introduced. Recommend building only after the identity/session work (user-actions wave).
- **Admin notifications** — roadmap Wave 19.

## External blockers (cannot be closed by code here)
- Live Stripe product/price provisioning + `invoice.*` webhook history → needed for real MRR/failed-payment ops.
- A live AI model wired to the gateway → needed for real (non-zero) AI cost attribution; deterministic mode reports
  NOT_AVAILABLE by design.
- Auth-provider (Supabase GoTrue) session/admin APIs → needed for session revocation and safe impersonation.
- Edge metrics/log backend → needed for true System Health (DB/jobs/webhook freshness) beyond internal evidence.
- Seeding the first real `platform_operators` row is an out-of-band action (migration/manual) — by design, never
  self-serve.

## Safety invariants (confirmed intact)
No autonomous optimization enabled. Mode-B provider writes HELD (`runtime-mode.ts` unchanged; the admin plane adds no
write capability and no new runtime mode). Tenant isolation not weakened (cross-tenant reads only through the new
SELECT-only role; all tenant mutation paths unchanged). `engine/` byte-identical (drift check green). No AI access to
any admin mutation tool. `MARKTING_E2E_TEST_AUTH` remains a hard 404 unless explicitly set (never in prod).

## Honesty statement
Every operator number shown is read live from the DB or rendered `NOT_AVAILABLE`; no metric, health light, or control
is faked. PARTIAL sections say so on the page. The P0 fix was prioritized and verified before any admin mutation
control was exposed, exactly as the mandate required.
