# Phase B — Professional Media-Buyer Depth — Exit Report

## Verdict
**Phase B is complete and CI-verified within its mandate.** MARKTING-AI now has genuine
lower-hierarchy depth (account → campaign → ad set/ad group → ad) driven by ONE deterministic engine,
a professional analytics-table system with shareable URL state, a capability-gated Breakdown Explorer,
evidence-backed computed diagnosis + contribution decomposition at every level, a transparent attention
queue, and a DB-level tenant RLS backstop — all honest about what the adapters can and cannot do.
Everything requiring live provider credentials remains BLOCKED_EXTERNAL and is never faked; Mode B
writes, autonomous optimization, and a live model remain HELD/DISABLED.

## Exit gates
A. Provider hierarchy audit complete — ✅ (docs 01)
B. Lower-level canonical identity works — ✅ (parentId/entityType; normalize + analyze; hierarchy-depth test)
C. No hierarchy flattening that loses provider semantics — ✅ (entityType preserved; provider-native naming)
D. Campaign → group → ad drill-down reachable where supported — ✅ (routes + loaders; DEMO seed; capability-gated)
E. Professional table mechanics complete — ✅ (AnalyticsTable + table-state)
F. Sort/filter/search/pagination bounded — ✅ (whitelisted sorts; page size ≤100)
G. URL state stable — ✅ (prefixed params; E2E-15 reload)
H. Breakdowns capability-gated — ✅ (registry single source of truth; Explorer)
I. Social-native dimensions surfaced where supported — ✅ (honest: CTR/CPM/CVR signals at depth; frequency/reach NOT_AVAILABLE)
J. Google/Search depth honestly represented — ✅ (ad-group/ad real; keyword/search-term NOT_SUPPORTED, not faked)
K. Lower-level deterministic diagnosis — ✅ (diagnoseEntity at group/ad; evidence)
L. Attribution honesty preserved — ✅ (per-provider; no cross-provider conversion addition; mixed-currency safe)
M. Money safety preserved — ✅ (formatMoneyMinor; per-row currency; no blending)
N. Phase-A date range reused — ✅ (single range param end-to-end)
O. RLS backstop materially strengthened — ✅ (restrictive policies + withTenant, defense-in-depth)
P. Real Postgres isolation tests green — ✅ (tenant-rls-backstop.database.test.ts; cloud-db lane)
Q. No N+1/unbounded queries introduced — ✅ (in-memory compute; perf test 100/1k/10k)
R. Browser E2E green — ✅ (E2E-14/15/16)
S. Accessibility green — ✅ (axe scan incl. new group + breakdown routes; zero critical/serious)
T. No new P0 — ✅ (security review: no exploitable findings)
U. Mode B HELD — ✅ (unchanged; no write path added)
V. Autonomous Optimization DISABLED — ✅ (unchanged)
W. No Phase C work started — ✅ (Phase C items documented, not implemented)

## What shipped
Canonical parent linkage + provider-native type; `analyzeAccount` descent with contribution; live
gatherer reads group/ad; sandbox/synthetic emit parent-linked group/ad (SYNTHETIC) for DEMO/CI; the
reporting capability registry (levels + dimensions, per the audit); the AnalyticsTable primitive +
URL-state controls + KPI presets (reports migrated); account→campaign→group→ad drill-down routes with
range/freshness/breadcrumbs/provider-native naming; the capability-gated Breakdown Explorer with the
protected-dimension guard; transparent attention-queue factor points; the tenant RLS backstop
(migration + withTenant + real-Postgres test).

## BLOCKED_EXTERNAL / out of scope (unchanged, never faked)
Live provider credentials (depth proven on synthetic/contract fixtures, never called live
verification); live breakdowns (RAW_ONLY at best — not in the normalized path); frequency/reach/video;
keyword/search-term/impression-share/PMax reporting; a live AI model; Mode-B writes; autonomous
optimization.

## Expert re-check
Media buyer 38→54 (PARTIALLY), agency 28→53 (PARTIALLY), search 33→44 (NO, honestly), paid social
32→50 (PARTIALLY), UX 62→84 (MOSTLY), red team ~30→72 (NO as-shipped / MOSTLY in architecture; trusts
what it shows). Unanimous: the depth/table/gating/isolation work is real and refreshingly honest; the
shared cap is the live block + the dimensions outside the normalized path — i.e. Phase C. See
`15-expert-recheck.md`.

## Invariants
Mode B HELD · autonomous optimization DISABLED · no live AI · no second analytics/connection/admin/
auth/crypto system · tenant isolation intact (now DB-backstopped) · no fabricated data · no live
verification claimed without evidence.
