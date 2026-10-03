# Phase 0 — Exit Report

Branch `claude/amazing-heisenberg-0unnak`, HEAD `7bb7f22`. Audit baseline `2e68a7f`. Phase 0 = the
security/correctness/safety gate. It does NOT include production infrastructure (backups, KMS, TLS,
hosting), which is Phase 1 (SRE). Each invariant below is classified PROVEN / PARTIALLY_PROVEN /
NOT_PROVEN / BLOCKED with evidence; no claim is marked PROVEN on code review alone.

## Invariant status

| Invariant | Status | Evidence |
|---|---|---|
| One sanctioned write path (no applyWrite bypass) | PROVEN | grep: only `engine.ts` apply + `AccountScopedProvider` call `applyWrite`; entry-point convergence (P0-A-EXIT); red-team item 12 HOLDS |
| Atomic apply (no concurrent double-write) | PROVEN (engine) / PARTIALLY_PROVEN (SQL) | core concurrency test (in-memory atomic store) VERIFIED_TEST; Postgres CAS `pending-claim.database.test.ts` runs in CI, NOT executed in this sandbox |
| Idempotent replay (no 2nd write on retry) | PROVEN | core + synthetic + snapchat/spotify tests; red-team item 2 |
| Failed apply is terminal (no blind re-execute) | PROVEN | core test `PENDING_SUPERSEDED` on retry; red-team fix |
| Apply-time re-preview + immutable digest | PROVEN | core `REPREVIEW_REQUIRED` test; red-team item 3 |
| Operation immutability (opHash) | PROVEN | `PENDING_MISMATCH` tests; red-team item 4 |
| Human approval + requester≠approver, all surfaces | PROVEN | core four-eyes tests; REST/MCP api_client cannot apply; red-team item 7 |
| Generic untyped mutation gated | PROVEN | core gate test; regex covers every shipped `*_api_*`; red-team item 8 |
| Object→account ownership on typed writes | PROVEN | account-scope + per-provider asserts; meta/tiktok regression tests; red-team item 5 |
| Currency/minor-unit integrity (no 100×/10×) | PROVEN | money suite (JPY/KRW/KWD/USD…), bridge JPY test, fail-closed unknown ccy; red-team item 9 |
| Expired operation cannot apply | PROVEN | double-gated peek+claim; red-team item 10 |
| Per-org engine report isolation | PROVEN | engine-demo cross-tenant test (org B 404); engine-client header test; red-team item 6 |
| Cloud tenant isolation (all queries org-scoped) | PROVEN (code) / PARTIALLY_PROVEN (runtime) | tenant-isolation audit; DB isolation suites run in CI, NOT executed here |
| No AI autonomous apply | PROVEN | assistant validate-only (ai_agent); red-team item 12 |
| Demo cannot reach a live account | PROVEN | demo runtime registers sandbox-only; `isDemoMode` unified with runtime mode; red-team item 11 + fix |
| Live writes disabled by default | PROVEN | `LIVE_WRITE_DISABLED` default; `assertApplyAllowed` 409; no FULL_AUTONOMOUS_WRITE in the type |
| Forward-only migrations; no destructive deploy reset | PROVEN (path) | `make migrate`; `db reset` marked LOCAL ONLY; CI applies migrations |
| Root CI runs the DB/authz/concurrency suites | BLOCKED (sandbox) | `.github/workflows/ci.yml` authored + YAML-valid; first green run must be confirmed on GitHub (no Actions runner here) |
| Data-trust floor (INSUFFICIENT_EVIDENCE) | PROVEN (module) / NOT_PROVEN (wired) | data-trust tests; wiring into the live recommendation surface lands with the Phase 1 live-data path |

## Per-subphase status
- **P0-A** write-path safety — COMPLETE (R0-01/02/03/05/06 + all-provider ownership close).
- **P0-B** money/currency — COMPLETE (canonical Money; Meta + bridge currency-aware; dashboard grouped).
- **P0-C** tenant/engine isolation — COMPLETE (SEC-01 fixed); R0-08 decision made (shared engine + per-org persistence; per-org engine identity staged for Phase 1).
- **P0-D** data ownership — COMPLETE (ownership map; forward-only migrate; no destructive deploy path).
- **P0-E** CI/guardrails — COMPLETE as code (CI authored; data-trust; live-state; self-approval default; kill-switch pin; Next.js reachability recorded as a blocker). CI first-green is BLOCKED on a GitHub runner.
- **P0-F** AI gateway — COMPLETE as decision/doc (no browser→model path holds; gateway + token metering deferred to Phase 1 with rationale).

## Tests executed in this sandbox (commands + results)
- `pnpm -r typecheck` → clean. `pnpm -r --filter './packages/*' run test` → 583 passed (core 57, apple 20, google 25, meta 24, linkedin 46, microsoft 13, reddit 8, pinterest 49, snapchat 37, spotify 45, tiktok 13, x 91, mcp 82, cli 73).
- `ADPORT_RUN_DATABASE_TESTS=0 pnpm --filter @adport/cloud test` → 323 passed, 36 skipped (DB-gated).
- engine `pytest -q` (clean workspace) → 177 passed, 3 skipped. engine-host tests → 8 passed. `node --test infra/scripts/stripe-setup.test.mjs` → 3 passed.
- **Totals: 1094 passed, 39 skipped, 0 failed.**

## DB-backed tests actually executed: NONE in this sandbox
Docker/Supabase are down here. The DB-gated suites (`pending-claim.database.test.ts`,
`markting-repository.database.test.ts`, `database.integration.test.ts`,
`account-selection.database.test.ts`, `mcp-oauth.database.test.ts`) are wired into the `cloud-db` CI
job (`ADPORT_RUN_DATABASE_TESTS=1` against a real Postgres) and are NOT proven here. This is the single
most important caveat: the Postgres atomic-claim CAS and the cross-tenant DB probes are proven by
construction + the in-memory model, and must be confirmed by the first CI run.

## Security findings remaining (after Phase 0)
- Next.js 16.3.1 image-optimization advisory — route reachable but same-origin only; recommend patch
  bump in the deploy pipeline (P0-E). P1 blocker, not a confirmed live RCE.
- Pre-existing P2/P3 from the audit not in Phase 0 scope: MCP refresh-token reuse/revocation cascade
  (SEC-06/14), Stripe webhook ordering (SEC-03), CSRF tokens (SEC-16), DB-level RLS backstop (SEC-18),
  encryption-key rotation/keyring (SEC-27), dependency vulns (SEC-12). These are Phase 1 items.

## Production blockers remaining (Phase 1 / SRE)
Backup/restore; KMS-held encryption key + rotation; TLS edge; graceful shutdown/drain; cluster-safe
externalized report index + kill switch; observability (metrics/traces/alerts) incl. an audited apply
step; AI usage/cost metering; CI first green run on GitHub; Next.js patch; real Supabase project; the
manual Arabic PDF shaping gate.

## Known limitations
- Provider APIs lacking native idempotency tokens cannot be made exactly-once provider-side; the local
  claim prevents a second dispatch and a failed apply is terminal.
- Engine analysis is fixture-only (assert_fail_closed pins sample mode); no adport→engine tenant-data
  read path yet (Phase 1 / R3).
- Data-trust gate and live-state ladder exist but the live-data path that exercises them is Phase 1.
- Latent (closed by construction): the demo alias map can hold real-provider bindings, harmless because
  the demo runtime registers no real provider tools (unified `isDemoMode` keeps DEMO sandbox-only).
- mypy reports 4 FastAPI untyped-decorator warnings on the engine host (pre-existing pattern).

## Manual production checks still required
See `PRODUCTION-VERIFICATION-RUNBOOK.md`: Arabic report shaping (hard gate), Next.js version vs
advisory, KMS/secret handling, backup/restore drill, forward-only migration on the real DB, runtime
safety state, and the live-write pilot checklist.

## Gate decisions (no gate marked READY without evidence)
- **GATE A — Real tenant data, READ ONLY: NOT READY.** The tenant-isolation controls for reads are in
  place (per-org report scoping, account-scoped provider reads, org-scoped queries), but the engine is
  fixture-pinned with no adport→engine tenant-data read path, and the production-infra blockers above
  are unmet. The *isolation* prerequisite is PROVEN (code) / to-be-confirmed in CI (DB suites).
- **GATE B — Real AI analysis, NO WRITES: NOT READY.** Requires the live-data read path (Phase 1) and
  the data-trust gate wired to the live surface; both deferred. The no-write guarantee itself HOLDS.
- **GATE C — Real provider write PREVIEW: NOT READY (as a product), machinery SOUND.** adport REST can
  already preview against a connected account safely (account-scoped, policy-gated, no apply), and the
  preview path is PROVEN; but surfacing it as a product needs the live-data path and the infra blockers.
- **GATE D — Human-approved live write to a dedicated TEST ad account: NOT READY (deliberately held).**
  All safety controls for it are PROVEN (four-eyes, atomic apply, apply-time re-preview, currency
  integrity, ownership), but Phase 0 keeps `LIVE_WRITE_DISABLED`; opening it needs
  `MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY`, the runbook §6 checklist, and the DB suites green in CI.
- **GATE E — First paying customer: NOT READY.** Production-infra blockers remain (backups, KMS, TLS,
  metering, CI first green, Next.js patch, Arabic manual gate). This matches the audit council verdict.

## What was NOT verified due to environment constraints
GitHub Actions CI execution (no runner); all DB-backed suites (no Docker/Supabase); Docker image
builds and the full compose stack; live model behaviour; live Stripe/OAuth; a real Supabase project;
browser/RTL e2e and Arabic glyph shaping; the Next.js build with a patched version. These are recorded
as BLOCKED-by-sandbox, not as passing.

## Features intentionally deferred to Phase 1+
Per-org engine caller identity + per-thread serialization + externalized kill switch (R0-08 impl);
adport→engine tenant-data read path (R3-01/02); data-trust gate wired to the live recommendation
surface; AI gateway service + token/cost metering ledger (P0-F design); the production-infra set
(backups, KMS, TLS, observability, async jobs); Next.js patch bump; MCP token reuse/revocation,
Stripe ordering, CSRF, RLS backstop, key rotation (audit P1/P2 outside Phase 0 scope). No Phase 1 work
was started.
