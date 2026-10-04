# 15 — Expert re-check (6 reviewers, Phase B delta)

Six reviewers independently re-reviewed ONLY the Phase B delta, grounded in the committed code (no
inflation; capabilities absent from the adapters were not credited). Scores are 0–100 vs the pre-Phase-B
baselines.

| Reviewer | Before → After | Acceptance (daily diagnostic workflow in-app?) |
|---|---|---|
| Senior Performance Media Buyer | 38 → **54** | PARTIALLY |
| Global Agency Media Buyer | 28 → **53** | PARTIALLY |
| Google / Search Specialist | 33 → **44** | NO (and honestly so) |
| Paid Social Specialist | 32 → **50** | PARTIALLY |
| SaaS Product / UX Expert | 62 → **84** | MOSTLY (leaning YES) |
| Skeptical Media-Buyer Red Team | ~30 → **72** | NO as-shipped / MOSTLY in architecture — **"would I trust what it shows? YES"** |

## Consensus — what Phase B genuinely delivered
- **Real lower-hierarchy depth in one engine.** campaign→ad_group→ad via provider-native parent
  linkage, contribution decomposition ("which child drove the move"), evidence-backed computed
  diagnosis at every level — no parallel pipeline, no hard-coded recommendation text, no fabricated
  nodes (verified + tested).
- **A production-grade table primitive** reused everywhere: whitelisted sorts, clamped bounded
  pagination, nulls-sink-last, shareable prefixed URL state, presets, correct accessible table
  semantics, RTL — UX 62→84.
- **Honest capability gating** from a single registry source of truth; provider-native naming; four
  distinct data states; the protected age/gender guard; RAW_ONLY/NOT_SUPPORTED/NOT_CONNECTED never
  dressed as data. The red team found **no fabrication, no dishonest live state, no cross-tenant leak**.
- **A real tenant RLS backstop** (restrictive policies + `withTenant` + real-Postgres test) as
  defense-in-depth, correctly scoped (service path + platform-admin read role unaffected).
- **Transparent attention queue** (deterministic factor points, no opaque score).

## The shared cap (why most answers are PARTIALLY, not MOSTLY)
Every reviewer landed on the same ceiling, and it is the one Phase B did not (and by mandate could not)
remove: **live is BLOCKED_EXTERNAL** (no provider credentials), so the depth runs on SYNTHETIC/DEMO
data and contract fixtures, not a buyer's real account; the rich drill-down **pages** are DEMO-wired
(the live gatherer reads depth into the orchestrator, not yet the navigable pages); and the
most-used daily surfaces that are **not in the normalized report path** — frequency/reach (social),
live placement/device/age/gender/geo breakdowns, keyword/search-term/impression-share (search) — remain
honestly NOT_AVAILABLE. These are exactly the Phase C items.

## Acted-on findings (fixed this phase)
- Data-scientist/UX: `TablePager` now has first/last controls (fixed a doc/code mismatch).
- Paid-social: `audience.ts PROVIDER_BREAKDOWN_SUPPORT` documented as engine-internal (not a second
  live-capability source; the registry is authoritative and the Explorer gates on it first).
- CI hardening: the RLS backstop predicate uses `nullif(current_setting(...),'')` so the "no-op when
  unset" clause is robust to Postgres returning empty-string for a dotted GUC; the RLS DB test and
  E2E-14 were corrected (column casing; target a seeded campaign that has an ad-set hierarchy).

## Recorded for Phase C (NOT implemented — out of mandate)
Wire live drill-down pages once credentials exist (+ an org↔account authorization gate on the drill
routes — latent today because live returns NOT_CONNECTED); bring frequency/reach and live breakdowns
and keyword/search-term/impression-share into the normalized report path (then search-term waste, still
review-only under Mode-B HELD); consolidate the two breakdown-support maps; UX polish (column-toggle
dismiss, mobile stacked tables, not-found for an unknown demo account id).
