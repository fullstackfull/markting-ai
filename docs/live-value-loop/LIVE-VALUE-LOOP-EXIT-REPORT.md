# Phase A — Live Value Loop — Exit Report

## Verdict
**The first trustworthy live value loop is built and CI-verified, within Phase A scope.** On a connected
account the pipeline now flows provider data → canonical observations → deterministic computed diagnosis →
user-facing explanation → inspectable evidence, under a professional, timezone-aware date-range control —
with no hard-coded flagship diagnosis and no demo/fixture leakage into the live path. Everything requiring
real external systems (provider credentials, a live AI model, autonomous writes, live commerce) remains
BLOCKED_EXTERNAL / HELD by mandate and is never faked.

## Exit gates
A. No misleading cross-provider conversion headline — ✅ (A1; `live-summary.ts`, attribution reviewer confirms RESOLVED)
B. No raw minor-unit money in reachable UI — ✅ (A2; `formatMoneyMinor`/`minorText` across all surfaces; tests)
C. Tenant audit DB append-only — ✅ (A3; migration 20261017000000; real-Postgres test)
D. Canonical gatherer complete — ✅ (A4; `live-gatherer.ts`, reuses the canonical model/engine)
E. Provider rows reach MetricObservation — ✅ (normalizeReportRows PLATFORM_REPORTED; tested)
F. Idempotency proven — ✅ (deterministic canonical ids; replay test)
G. Source provenance preserved — ✅ (trust tier/source; LIVE provenance; source-isolation guards intact)
H. Date range consistent — ✅ (A6; single `range` param through the shared loaders)
I. Timezone handling explicit — ✅ (A6; account/org tz when known, UTC fallback FLAGGED)
J. Flagship diagnosis no longer hard-coded — ✅ (A5; computed via analyzeAccount in the live path)
K. Diagnosis evidence-backed — ✅ (EvidenceRef on every diagnosis; live-value-loop test)
L. Mixed currency safe — ✅ (no blended FX; mixedCurrency flagged; tests)
M. E2E path proven — ✅ (contract-fixture E2E through the real pipeline + gatherLive wiring test + browser E2E-13)
N. Real Postgres tests green — ✅ (audit append-only; cloud-db lane)
O. CI green — ✅ (all 7 lanes on the final head)
P. No new P0 — ✅ (no new P0; see below)
Q. Mode B still HELD — ✅ (runtime-mode unchanged; gatherer is read-only)
R. Autonomous optimization still DISABLED — ✅ (unchanged)

## What shipped (code-solvable, done)
A1 per-provider conversions/ROAS + per-currency spend; A2 canonical minor-unit money everywhere
(currency-correct JPY/KWD, mixed/unknown labeled); A3 DB-enforced tenant audit append-only; A4 live
ReportRow→MetricObservation gatherer with fail-closed validation, provenance, idempotency, honest
NOT_CONNECTED degrade; A5 computed flagship diagnosis; A6 timezone-aware range + comparison period +
freshness disclosure, propagated through the shared loaders and surfaced on workspace + account.

## BLOCKED_EXTERNAL / out of scope (unchanged)
Live provider OAuth credentials (the loop is proven on contract fixtures, never called live verification);
a live AI model (deterministic MODEL_DISABLED); autonomous/Mode-B writes (HELD); live commerce transport
(so net-of-money PROFIT diagnosis stays demo-only); incrementality/MMM + significance testing.

## Expert re-check
3 reviewers now WOULD_USE_AS_SECONDARY_TOOL (media buyer ↑ from PILOT, data science, attribution), 1
WOULD_PILOT (ecommerce ~3.7), 1 red team WOULD_NOT_USE (bordering PILOT). Unanimous: Phase A materially
improved readiness; the remaining caps are the out-of-scope external items. See `10-expert-recheck.md`.

## Invariants
Mode B HELD · autonomous optimization DISABLED · no live AI · no new admin/connection engine · tenant
isolation intact · no fabricated data · no live verification claimed without evidence.
