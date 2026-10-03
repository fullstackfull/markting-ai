# 10 — Expert Creative Red-Team

An independent adversarial panel reviewed the Phase-4 creative system read-only (no writes, no network)
against: strategist trust, fatigue over-calling, premature winners, media-cost vs creative attribution,
incomparable comparisons / blended money, visual hallucination + protected-trait inference, prompt
injection / memory poisoning, provider-write paths / human approval, dedup merging distinct creatives,
and DB / performance / versioning / tenancy.

## Verdict

No finding reached a provider-write path, a protected-trait inference, or a human-approval bypass —
those invariants **HOLD** and were verified in code, not assumed (see below). The panel surfaced one
concrete test-masked DB bug and five docstring-vs-enforcement gaps. All material findings were fixed
with regression tests before exit.

## Findings and dispositions

| # | Finding | Rank | Disposition |
|---|---------|------|-------------|
| 1 | Fatigue CPM ruling-out only capped confidence; `FATIGUE_SIGNAL` still fired when CPM fell | PARTIAL (high) | **FIXED** — `cpmOk` is now a HARD GATE: fatigue-shaped signals with a falling or unknown CPM are held at `WATCH`, and no fatigue recommendation is emitted (`fatigue.ts`). |
| 2 | `creativeContribution` asserted `CREATIVE_DRIVEN` (and "media cost stable") when CPM movement was unknown | PARTIAL | **FIXED** — unknown CPM on an efficiency metric (CPA/ROAS) → `INSUFFICIENT_EVIDENCE`; the note never claims stability it did not measure (`performance.ts`). |
| 3 | `saveAnalysis` not idempotent for NULL `source_hash` (fatigue/classification/lifecycle/rating) — `on conflict` never fired, row bloat, wrong `stored` | PARTIAL (concrete bug) | **FIXED** — sourceless analysis stores a `''` sentinel instead of NULL, so the unique index dedups it; `getAnalysis` aligned. New DB-gated regression asserts a single row + preserved first result. |
| 4 | `creativeShares` blended spend across currencies | PARTIAL | **FIXED** — mixed-currency set → `spendShare: null` (counts stay currency-agnostic). |
| 5 | Clusters summed spend across currencies and sorted by that blended number | PARTIAL | **FIXED** — mixed-currency cluster → `spend: null`; clusters ordered by currency-agnostic conversions first. |
| 6 | Dedup merged distinct images sharing copy when no content hash; `dedupGroups` was O(N²) | PARTIAL | **FIXED** — the only merge path is a confirmed shared media hash (identical copy without it → `RELATED`, never merged); `dedupGroups` buckets by media hash → O(N). |
| — | Minor: `rising_frequency` mislabeled (fired on absolute freq), redundant disjunct, redundant lifecycle predicate, missing membership reverse index | cosmetic | **FIXED** — renamed to `frequency_pressure`, dead branches removed, `markting_creative_memberships (organization_id, creative_id)` index added. |

## Invariants verified as HOLDING (not assumed)

- **No write path / human approval:** `CreativeRecommendation.requiresHumanApproval` is the literal type
  `true`, spread into every recommendation; there is no endpoint/path/body field; test ideas are
  `kind:'HYPOTHESIS'` and never launched; `store.ts` performs only analysis inserts/upserts; the
  Phase-1 registry read-only gate deterministically refuses any non-read-only tool, and no creative
  code invokes a write tool.
- **Visual hallucination / protected traits:** `buildVisualAnalysis`/`buildVideoAnalysis` return
  all-`UNKNOWN` + `metadataOnly:true` without a model; only an explicit model result can set
  PRESENT/ABSENT; copy/filename cannot leak into features; there is no schema field for age, gender,
  ethnicity, religion, health, orientation, or identity, and `face_present` is a bare boolean.
- **Injection / memory poisoning:** ad copy and transcripts are regex-matched to a taxonomy and stored
  as evidence spans, never executed; Phase-3 `SOURCE_RULES` and `CONNECTED_SOURCE_FACT_KEYS` keep
  provider/ad text out of preferences and free-text facts; the derived-pattern SAMPLE guard
  (`< MIN_SAMPLE_FOR_CONFIDENCE` refused) is real, so "pattern X always wins" from n=3 never becomes
  memory, and derived/historical memory lands below EXPLICIT_HUMAN trust.
- **Premature winners / low-spend losers:** `rateCreative` gates on `< 30` conversions →
  `INSUFFICIENT_DATA`; a low-spend or zero-conversion creative is never a loser; `STRONG_PERFORMER`
  needs both ROAS and CPA to beat a comparable cohort.
- **Tenancy:** all six tables are org-keyed, composite-FK'd, RLS-enabled (restrictive server-only +
  backend policy, anon/authenticated revoked); every query filters `organization_id`; `upsertCreative`
  rejects an org mismatch before any DB access.

The panel's report is model output and was treated as findings to verify, not as authority; each fix
was validated against the suite (`test/phase4-redteam-fixes.test.ts` + the DB-gated idempotency case).
