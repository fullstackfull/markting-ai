# 00 — Phase B baseline

Phase A shipped a trustworthy live value loop (provider → MetricObservation → deterministic
diagnosis → evidence), a timezone-aware date-range control, canonical money formatting, per-provider
(non-blended) conversions, and DB-enforced append-only tenant audit. All 7 CI lanes green.

Phase B goal: make MARKTING-AI materially deeper and more credible for a professional media buyer —
lower-hierarchy depth, provider-native dimensions (where real), professional table mechanics, a tenant
RLS backstop, and evidence-backed diagnostics at lower levels. Phase B does **not** wire a live model,
enable Mode B writes or autonomous optimization, add multimodal/SSO/MMM, or create a second analytics,
connection, admin, auth or crypto system.

## What already exists and is reused (not rebuilt)
- Canonical observation + diagnosis engine: `MetricObservation`, `normalizeReportRows`,
  `analyzeAccount`, `diagnoseEntity`, `campaignContribution`, `EvidenceRef` — all already
  **level-generic** (the `EntityLevel` union is `account|campaign|ad_group|ad`).
- Date-range/freshness (A6): `lib/cloud/date-range.ts`, `components/range-control.tsx`,
  `components/freshness-bar.tsx`.
- Money (A2): `components/ui.tsx` `formatMoneyMinor`/`MIXED_CURRENCY`, `lib/money-ui.ts`.
- Connection capability registry (prior phase): `lib/connections/registry.ts` (lifecycle/auth
  capabilities) — **extended**, not duplicated, with a reporting levels/dimensions sub-structure.
- Breakdown analysis math: `lib/markting/intelligence/audience.ts` (`analyzeBreakdown`, HHI
  concentration, protected-dimension guard) — reused for the canonical breakdown model.

## The three real gaps Phase B closes
1. `ReportRow`/`MetricObservation` carry **no parent linkage and no provider-native entity type** —
   so a campaign→group→ad tree cannot be built. (Added as optional fields; no flattening.)
2. `analyzeAccount` iterates account+campaign only — it never descends to group/ad.
3. There is **no professional analytics table primitive** — `reports` and `live-data` duplicate a
   hand-built campaign table; there is no sort/filter/pagination/URL-state system.

See `01-provider-hierarchy-audit.md` for the honest per-provider capability matrix that bounds
everything below.
