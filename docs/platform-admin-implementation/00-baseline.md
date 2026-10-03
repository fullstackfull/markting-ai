# 00 — Platform Super Admin Implementation: Baseline

**Repo:** `fullstackfull/markting-ai` · **Branch:** `claude/amazing-heisenberg-0unnak` · app `platform/apps/cloud`.
**Mandate:** build the SaaS owner/operator control plane, reusing existing modules, never weakening tenant isolation,
preserving all Phase-0 invariants (no autonomous optimization, Mode-B provider writes HELD).

## Starting point (from the discovery audit, docs/platform-admin/00–15)
Tenant admin existed; **no** platform admin, `/admin`, platform identity, or cross-tenant role. 41 gaps
(P0=1, P1=14, P2=22, P3=4). The one P0 (GAP-SEC-01): the kill switch existed but was **not enforced** on the real
provider-apply path.

## What this program built (in the mandated order)
- **WAVE 0 (safety first):** closed GAP-SEC-01 — the kill switch now fails closed on the real apply seam; plus
  service-account hashing hardening and MCP token-purge scheduling. See `01`/`10`.
- **WAVE 1 (foundation):** a **separate platform security plane** — `platform_operators` roster (authority never
  from org membership), `requirePlatformOperator`/`requirePlatformRole`/`requirePlatformMutator` guards, a dedicated
  SELECT-only `adport_platform_admin` DB role for cross-tenant reads, and an append-only `platform_admin_audit`. See `01`.
- **WAVES 2–5 (read-first + safe mutations):** the `/admin` shell (distinct chrome, server-guarded), Overview,
  Organizations (list + detail), Users (list + detail), Security & Audit, Governance & Safety — plus two fully-backed,
  audited, reason-required mutations built on the enforced kill switch (per-org freeze; GLOBAL kill, SUPER_ADMIN only).
- **WAVE 27 (E2E):** browser authz proof — operator access vs tenant-owner/anonymous denial.
- Honest PARTIAL stubs for the sections whose operator surfaces are scheduled later (Plans & Billing, AI Ops,
  Providers, Commerce, System, Support, Feature Flags, Settings) — no fabricated data.

## Honesty & scope
This is a **foundational, safe, CI-verified implementation with a real read-first vertical slice and the P0 safety
fix** — not a complete 35-wave build. The exit capability matrix (`15`) marks each area READY / PARTIAL / DEFERRED
with evidence, and the exit report (`PLATFORM-ADMIN-EXIT-REPORT.md`) lists exactly what remains and the external
blockers. Phase-0 invariants are intact; no Mode-B writes were enabled; no autonomous optimization was added.

## Verification posture
- Node lane: typecheck + package/cloud unit tests.
- cloud-db lane (real Postgres): migrations apply forward-only; the kill-switch enforcement test and the platform
  authz/isolation test run here.
- e2e lane (seeded Supabase, DEMO runtime): authenticated journeys + axe + the admin authz E2E.
- security lane: dependency audit, gitleaks, migration-RLS posture (every public table enables RLS — the two new
  platform tables included).
