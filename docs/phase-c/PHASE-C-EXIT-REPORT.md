# Phase C0 + Phase C — Exit report

Branch: `claude/amazing-heisenberg-0unnak`. Posture held throughout: **no autonomous optimization, no
uncontrolled provider writes, no fabricated live validation, Mode B HELD, no additional product phases
started.**

## Phase C0 — pre-live safety closure (CLOSED)

| Gate | Result |
|------|--------|
| A — ONE canonical account-authz guard | `lib/cloud/account-authz.ts` (`authorizeTenantAccount`) |
| B — full hierarchy ownership enforced | account guard + nested `found:false` on every child; DEMO 404s a broken chain |
| C — capability registry canonical | duplicated `PROVIDER_BREAKDOWN_SUPPORT` removed; `supportsBreakdown` projects the registry (pinned by a test) |
| D — Phase-B DEMO fallback removed | `seedClientForAccount` returns `undefined` for unknown ids → NOT_FOUND |
| E — deep-drill E2E passes with content | E2E-14 follows real links Workspace→Account→Campaign→Group→Ad, asserts content at each level |
| F — cross-tenant URL-guessing tests pass | DEMO unit + LIVE real-Postgres tests; no existence oracle |
| G — no exploitable P0/P1 | pre-live security review (`14-security-review.md`): none in the code-reviewable surface |
| H — CI 7/7 green | run #64 success on all lanes (node, cloud-db, e2e, security, engine, infra, drift) |

**Root cause found + fixed (C0.4):** this Next build does not URL-decode dynamic route params, so
composite colon-ids built with `encodeURIComponent` arrived percent-encoded and never matched the seed —
the long-standing Phase-B "deep-drill divergence." Fixed with `lib/cloud/route-params.ts` `decodeParams`,
reproduced + verified against a local seeded Supabase + standalone build (36/36 browser, 1047 unit+DB).

## Phase C — code-solvable infrastructure (built, pure, unit-tested)

- **C8 sync runner** (`ops/sync-runner.ts`): sync-type taxonomy, bounded concurrency, per-tenant
  fairness, provider token-bucket rate limit, lease + crash-recovery reclaim, full-jitter backoff,
  dead-letter, kill-switch gating, idempotency. (12 tests.)
- **C9 freshness SLO** (`ops/freshness.ts`): NEAR_REALTIME/HOURLY/DAILY/ON_DEMAND tiers + fail-honest
  classifier. (8 tests.)
- **C11 schema drift** (`ops/schema-drift.ts`): `PROVIDER_SCHEMA_CHANGED` classifier. (7 tests.)
- **C21 Mode-B readiness** (`ops/mode-b-readiness.ts`): classification only; Mode B HELD; nothing reaches
  production-approval (live write verification BLOCKED_EXTERNAL). (5 tests.)
- Reused + documented: C13 metering (`usage-ledger.ts`), C14 eval harness, C18 observability model +
  C19 alert rules, commerce model/sync/webhook-verifier/reconciliation, write-safety stack.

## BLOCKED_EXTERNAL (no credentials — reviewed, never fabricated)

C1–C7 live provider reads / native depth / live commerce transport; C10 live contract capture (zero
LIVE_CAPTURED cassettes); C12 live model narration (`liveModelAvailable()===false`); the C8 live
execution loop + durable queue; the mounted commerce webhook route + per-provider signature adapters;
C20 alert delivery + incident/escalation workflow; observability backend export. Live OAuth
callback/token-refresh/replay (per the security review).

## Council (C23) + global recheck (C24)

16 reviewers: **8 PASS · 7 PARTIALLY · 1 NO**, mean ≈ **74** (≈ 51 at Phase B exit). Engineering/
governance reviewers PASS (architect 87, red-team 85, FinOps 84, appsec 82); practitioners held at
PARTIALLY/NO because live capability is BLOCKED_EXTERNAL. No overclaim detected. See `17-global-recheck.md`.

## Verdict

A trustworthy, well-architected **pre-live foundation** that has honestly closed everything code alone can
close. It is **not** a deployable live product: that requires provider credentials, normalized live
breakdowns, a running sync worker, a live model narrator, and alert delivery — each BLOCKED_EXTERNAL or an
honest outstanding gap, none faked. Next action is a human decision: provision sandbox credentials to
begin live verification (then the controlled-pilot design in `16-controlled-pilot.md`), or continue
closing the non-credential gaps (alert delivery / incident workflow, mounted webhook route).
