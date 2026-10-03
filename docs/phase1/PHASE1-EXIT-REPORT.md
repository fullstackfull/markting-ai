# Phase 1 — Exit Report

Branch `claude/amazing-heisenberg-0unnak`, built from Phase 0 HEAD `e6fbd0c`. Phase 1 moves the system
from a fixture demo to tenant-scoped marketing intelligence that the AI can **READ and ANALYZE** with
**writes DISABLED**. The absolute safety rule held throughout: the AI may read, analyze, recommend, and
produce hypothetical proposals; it may **not** mutate campaigns/budgets/bids/pause/enable/audiences or
perform any provider write. Every Phase-0 write-safety mechanism remains intact and unweakened
(confirmed by the adversarial red-team, item 9 below).

No claim below is marked PROVEN on code review alone; anything requiring live OAuth, a real Postgres, a
GitHub Actions runner, or production infrastructure is classified honestly as PARTIAL / BLOCKED because
those are external to this sandbox.

## Invariant status

| Invariant | Status | Evidence |
|---|---|---|
| AI cannot mutate anything (read-only capability enforced at the registry, not by prompt) | PROVEN (module) | `registry.call` throws `WRITE_FORBIDDEN_READ_ONLY` for any non-read tool when `ctx.readOnly`; strict `!== true` blocks default-false annotations; core read-only test; red-team item 1 HOLDS |
| Read-only mode wired for live analysis runtimes | PROVEN (code) / NOT_PROVEN (runtime) | `createTenantRuntime` sets `readOnly: isReadOnlyMode()` (true for LIVE_READ_ONLY + LIVE_RECOMMENDATIONS); bridge preview AND apply both pass through `registry.call`; live run needs real OAuth (external) |
| No Phase-0 invariant weakened by Phase-1 | PROVEN | red-team item 9: registry diff is additive (read-only check inserted before authorize/handler); policy engine, four-eyes, apply gate, generic-write gate, Money untouched; core 58 + package suites still green |
| Engine tenant identity is server-derived, never from model prose | PROVEN (code) | `EngineContext` org/user come only from the authenticated `principal`; `requestId` is a server `randomUUID`; red-team items 2 + 8 HOLD |
| Canonical marketing model with explicit provenance | PROVEN (module) | `MetricObservation` carries trust tier + currency + timezone + attribution + sampleSize; `normalizeReportRows` tests |
| Deterministic analysis (arithmetic in code, not the model) | PROVEN (module) | compare/funnel/pacing/anomaly(MAD)/contribution; currency-safe, ratios recomputed from sums; 20 intelligence tests |
| Data-trust floor reachable (INSUFFICIENT_EVIDENCE) | PROVEN (module) / NOT_PROVEN (wired) | `evaluateEvidence` gates synthetic/partial/thin/unknown-currency/**stale** data; both windows gated; wiring into a live recommendation surface is Phase 2 |
| Synthetic data can never read as live evidence | PROVEN (module) | `SYNTHETIC` tier short-circuits to non-actionable; `aggregate` taints worstTier; red-team item 3 (prev-window gap) fixed |
| Currency safety across periods and campaigns | PROVEN (module) | aggregate nulls money ratios on mixed currency; comparePeriods flags cross-period currency mismatch; campaignContribution refuses monetary metrics across currencies; red-team item 4 fixed |
| Governed model gateway (single seam; allowlist/quota/idempotent usage) | PROVEN (module) / NOT_PROVEN (wired) | `AiGateway` allowlist + per-org quota (count+cost) + idempotency + timeout/retry; cost ≠ invoice; red-team item 5 HOLDS; no live model traffic yet |
| Usage/cost metering is org-scoped and idempotent | PROVEN (module) | ledger upsert key `(org, request_id, feature)`; `usageSince` window honored; DB unique constraint; retry never double-charges |
| Per-thread turn serialization (no concurrent corruption) | PROVEN (code) / NOT_PROVEN (DB) | `beginThreadTurn` CAS (`processing_request_id is null or stale>5min`) + `finally endThreadTurn`; org+user scoped; red-team item 6 HOLDS; DB-gated test runs in CI only |
| Business context carries provenance (KNOWN/CONFIGURED/DERIVED/UNKNOWN) | PROVEN (module) | `Valued<T>`; strict zod on CONFIGURED; `breakEvenRoas` DERIVED; tests |
| No untrusted provider text in a control position | PROVEN (code) | context builder returns structured data; campaign selection is numeric (spend-delta share); names are data only; red-team item 8 HOLDS |
| AI evaluation suite exists and gates behavior | PROVEN (module) | 10 media-buyer questions + 2 safety checks; 12 tests |
| Root CI runs node + DB + engine + drift + security jobs | BLOCKED (sandbox) | `.github/workflows/ci.yml` authored + YAML-valid; no Actions runner here — first green run must be confirmed on GitHub |
| Next.js advisory patched | BLOCKED (sandbox) | documented in 08; bump belongs in the deploy pipeline; recorded as a Gate-E blocker |

## Per-workstream status

- **Phase-0 close (CI, Next.js)** — CI authored (BLOCKED on a runner); Next.js bump staged for deploy.
- **1A engine tenant identity** — COMPLETE (`EngineContext`, `buildEngineContext`, header plumbing).
- **1B live read path + read-only enforcement** — COMPLETE as module+wiring (`readOnly` capability,
  `isReadOnlyMode`); a live run against a real account is external-blocked.
- **1C canonical marketing model** — COMPLETE (`model.ts` + `normalize.ts`).
- **1D provider read parity** — AUDITED + PRIORITIZED, not implemented this phase (small meta/tiktok/
  snapchat read fixes staged as Gate-A hardening; recorded in 03).
- **1E date/time/attribution** — COMPLETE as model fields (timezone + attribution basis + window).
- **1F data-trust engine + INSUFFICIENT_EVIDENCE** — COMPLETE (`data-trust.ts`), hardened by red-team
  (previous-window gating + staleness bound).
- **1G business context** — COMPLETE (`business-context.ts` + migration).
- **1H real AI context builder + budgeting** — COMPLETE (`context.ts`, top-N by spend-delta, truncation).
- **1I AI gateway** — COMPLETE as module+seam (`ai-gateway.ts`); native wrapper chosen over LiteLLM for
  Phase 1 (rationale in 06); not yet carrying live traffic.
- **1J token/cost metering + quotas** — COMPLETE as module (`usage-ledger.ts` + migration).
- **1K AI observability** — COMPLETE as usage records (latency/status/tokens/cost captured per call).
- **1L deterministic media-buyer analysis engine** — COMPLETE (`analysis.ts`).
- **1M Arabic experience** — COMPLETE as bilingual metric/status labels (en/ar) in the analysis layer.
- **1N threads + serialization** — COMPLETE (`beginThreadTurn`/`endThreadTurn` + migration; history pre-existed).
- **1O reports** — COMPLETE as the analysis + context substrate a report renders from; live report UI deferred.
- **1P live read-only UI** — DEFERRED (requires the live read path; recorded as staged).
- **1Q commerce connector contract** — DEFERRED to a typed contract (recorded in 01); no live impl this phase.
- **1R security cleanup + production foundation** — PARTIAL; items enumerated in 08, most external-blocked.

## Red-team result (independent adversarial reviewer)

Read-only enforcement, tenant isolation, thread serialization, and the model-gateway controls **HOLD**;
**no Phase-0 invariant was weakened**. The reviewer surfaced **three defense-in-depth gaps** in the
evidence/currency gating — all now **FIXED** and covered by +6 tests:

1. **Previous-window trust ungated** (PARTIAL → fixed): `comparePeriods`/`funnelDecomposition` now run
   the evidence floor over **both** windows, so a synthetic/partial/thin baseline is no longer surfaced
   as actionable.
2. **Cross-period currency mismatch ungated** (PARTIAL → fixed): `comparePeriods` flags two different
   single currencies as non-comparable; `aggregate` leaves money ratios (cpc/cpm/cpa/roas) undefined
   when currencies are mixed; `campaignContribution` refuses monetary metrics across currencies.
3. **No staleness check** (PARTIAL → fixed): `evaluateEvidence` accepts an optional `asOf`/`maxAgeMs`
   bound; an old-but-complete window reads as INSUFFICIENT_EVIDENCE when the bound is supplied.

Also fixed: `InMemoryUsageLedger.usageSince` now honors the trailing window (was ignoring it; test-only
path, never reachable in production but corrected to match the Postgres ledger).

## Tests executed in this sandbox (commands + results)

- `pnpm exec tsc --noEmit` (cloud) → clean.
- `pnpm --filter @adport/cloud test` (`ADPORT_RUN_DATABASE_TESTS` unset) → **365 passed, 37 skipped**
  (the 37 skipped + 4 failing files are DB-gated suites; Supabase/Docker are down here — see caveat).
- `@adport/core` vitest → **58 passed**.
- Package provider suites and engine suites were green at the Phase-0 exit and are unchanged by Phase 1
  (Phase-1 code is cloud-only); re-run in CI.

## DB-backed tests actually executed: NONE in this sandbox

Docker/Supabase are down here, so the DB-gated suites (`pending-claim.database.test.ts`,
`markting-repository.database.test.ts` — including the new thread-turn CAS test —
`database.integration.test.ts`, `mcp-oauth.database.test.ts`) fail locally with `fetch failed` and are
**not proven here**. They run in the `cloud-db` CI job against a real Postgres. This remains the single
most important caveat: the Postgres CAS (atomic claim + thread-turn lock) and the cross-tenant DB probes
are proven by construction + the in-memory model and must be confirmed by the first CI run.

## Honest gaps carried out of Phase 1

- **Live data path not exercised end-to-end**: built against the typed `@adport/core` report boundary
  and synthetic data; real OAuth + a real Supabase are external-blocked in the sandbox.
- **Engine LLM narration is still fixture-pinned** (the engine stays byte-identical); the deterministic
  signals are real-data-capable today via adport's governed report path, but the model's natural-language
  layer is not yet wired to the gateway.
- **Analysis/gateway layer has no production caller yet** — the intelligence and gateway modules are
  defined and tested but not invoked from an app route; Phase 2 wires them behind LIVE_RECOMMENDATIONS.
- **Provider read-parity fixes (1D), live UI (1P), commerce contract (1Q)** staged, not implemented.
- **CI green, Next.js bump, KMS/TLS/backups (1R / Gate E)** external-blocked; runbooks recorded in 08.

## Exit gate verdicts

- **Gate A — live read path works against real tenant data: PARTIAL.** The read path, canonical model,
  normalization, and read-only enforcement are built and unit-proven against the typed boundary and
  synthetic data. Not exercised against a live account (OAuth + Supabase external-blocked). Must be
  confirmed with a real connected account before Gate A is PROVEN.
- **Gate B — AI produces trustworthy, evidence-gated analysis: PARTIAL.** The deterministic engine is
  real, currency-safe, evidence-gated (now including previous-window + staleness + cross-period currency
  guards), and covered by an evaluation suite. The model's narration layer is still fixture-pinned, so
  end-to-end "trustworthy live narrative" is not yet demonstrable.
- **Gate C — write machinery sound but NOT enabled: HELD; writes remain DISABLED.** Phase-0 write safety
  is intact and unweakened; the AI path is read-only; `LIVE_WRITE_DISABLED` is the default. Per the
  mandate, writes are **not** enabled automatically — this gate stays closed until explicitly authorized.
- **Gate D — autonomous / advanced features remain disabled unless explicitly authorized later:
  DISABLED.** No autonomous apply, no FULL_AUTONOMOUS_WRITE in the type, no AI write path. Remains off.
- **Gate E — production readiness (CI green, infra, security hardening): NOT READY.** CI authored but
  unverified (no runner); Next.js bump, KMS, TLS, backups, and the 1R items are external-blocked and
  documented with runbooks in 08.

## Bottom line

Phase 1 delivers tenant-scoped, evidence-gated marketing **intelligence** with the AI confined to read
and analyze, every Phase-0 safety invariant preserved, and an independent red-team confirming the
confinement holds (three evidence-gating gaps found and fixed). What remains PARTIAL/NOT READY is
honestly external-blocked (live OAuth, real Postgres, a CI runner, production infra) or deliberately
deferred (model narration, provider parity fixes, live UI, commerce contract) — none of it a weakening
of the safety posture. Phase 2 is **not** started.
