# 10 — Expert Re-check (5 reviewers, Phase A delta)

Five of the original council reviewers re-reviewed ONLY the Phase A changes, grounded in the changed code.

| Reviewer | Prior | Now | Materially improved? |
|---|---|---|---|
| Senior performance media buyer | WOULD_PILOT (~2.6) | **WOULD_USE_AS_SECONDARY_TOOL** | Yes — diagnosis 2→4, date control 0→4.5, money 1.5→4, evidence 2.5→4 |
| Ecommerce / profit buyer | WOULD_PILOT (~3.6) | **WOULD_PILOT (~3.7)** | Yes for ad-money legibility + attribution honesty; profit gap unchanged (commerce still dormant) |
| Marketing data scientist | WOULD_USE_AS_SECONDARY_TOOL (~4.0) | **WOULD_USE_AS_SECONDARY_TOOL (~4.1)** | Yes — fail-closed validation into the real engine; flagged a `windowComplete` defect (now fixed) |
| Attribution expert | WOULD_USE_AS_SECONDARY_TOOL | **WOULD_USE_AS_SECONDARY_TOOL** | Yes — the MATERIAL blended-conversions finding is RESOLVED (cross-provider honesty 5, was ~1) |
| Skeptical red team | WOULD_NOT_USE (~1.5) | **WOULD_NOT_USE, bordering WOULD_PILOT** | Yes on honesty/plumbing/data-integrity; core gaps (live creds, AI, autonomous action) remain — all out of Phase A scope |

## Consensus
Phase A **materially improved adoption readiness**. Every prior Phase-A blocker is genuinely addressed in
code: A1 blended-conversions RESOLVED (attribution confirms), A2 money legible + currency-correct, A3 audit
append-only DB-enforced, A6 timezone-aware range + freshness with explicit UTC fallback, A4/A5 the live
flagship diagnosis computed from canonical observations (no hard-coding, no fixture branch).

## Acted-on review findings
- Data scientist's `windowComplete` defect (a custom range ending today was mislabelled complete) → fixed in
  `date-range.ts` (resolver returns `windowComplete = end < today`), locked by a test.
- Red team's fair point that `gatherLive` had no direct test and "live loop end-to-end" over-claimed →
  closed with `test/live-gatherer.test.ts` (mocked provider read: computes media diagnoses, honest
  NOT_CONNECTED degrade, rejects invalid rows). The docs state plainly that the loop is proven via contract
  fixtures, NOT live verification (which requires provider credentials = BLOCKED_EXTERNAL).

## Remaining (all explicitly OUT of Phase A scope)
Live provider credentials (BLOCKED_EXTERNAL), a live AI model, autonomous/Mode-B writes, live commerce
transport, incrementality/MMM, significance testing. These are what still cap daily adoption; Phase A did
not attempt them by mandate.
