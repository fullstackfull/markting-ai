# 13 — Security Review — P0 CLOSED; posture unchanged elsewhere

## Program 0 — DONE (CI-green on real Postgres)

The confirmed P0 (two Phase-1 tables without RLS/deny/revoke) is fixed:

- Migration `20261012000000_phase1_rls_fixup.sql` — forward-only, data-preserving — brings
  `markting_ai_usage` and `markting_business_context` to the house convention (RLS enabled + restrictive
  `authenticated using(false)` deny + `adport_backend` policy + `revoke from anon, authenticated`),
  identical to every Phase 2-7 table.
- `test/phase1-rls-fixup.database.test.ts` (real Postgres, CI) proves org A cannot read or write org B's
  `ai_usage` or `business_context`, the browser role has no access at all, and the server
  (`db`/`adport_backend`) path still reads both. **Verified green in CI run 24.**

## New surfaces — no new attack surface

The Wave-3 surfaces are read-only server components that call the orchestrator; they carry no provider
mutation path (every recommendation is `requiresHumanApproval: true`). Security identity in the
orchestrator context is server-derived from the authenticated tenant, never from question text or a
client body. The Phase-0 governed write chain is untouched. The CI `security` lane (dependency audit +
secret scan) stayed green across all waves.

## Remaining (Program 24) — NOT_STARTED this pass

The hardening slices from `docs/reassessment/06`: systematic RLS regression coverage across all tables,
constant-time service-account hash compare, explicit CSRF tokens, a dedicated SAST lane. These are
recorded as outstanding; none is newly introduced by this program's changes.
