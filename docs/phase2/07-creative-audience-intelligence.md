# 07 — Creative & Audience Intelligence (2L / 2M)

## Creative foundation (2L) — `intelligence/creative.ts`

NOT full multimodal understanding (that is a later phase). It normalizes creative-level data
(id/type/copy/first_seen/last_seen/spend/impressions/CTR/CPA/ROAS/frequency/relationships) and computes
deterministic structural signals:

- **Spend concentration** across creatives (HHI → DIVERSE/MODERATE/CONCENTRATED).
- **Performance dispersion** (coefficient of variation of CPA across creatives).
- **New-vs-old** split by `firstSeen` age.
- **Fatigue** — explicitly a *signal*, never proof. A declining CTR is `NOT_PROVEN` unless high
  frequency supports it, in which case `FATIGUE_SIGNAL` (still "signal, not proven"). Insufficient
  impressions/history → `INSUFFICIENT_DATA`. Ad copy is carried as DATA only, never interpreted.

## Audience / placement (2M) — `intelligence/audience.ts`

Only dimensions a provider actually exposes are analyzed; unsupported dimensions are marked, never
fabricated (`PROVIDER_BREAKDOWN_SUPPORT`, consistent with doc 09 — breakdowns exist for meta/google/
tiktok/snapchat; others ✗). Finds spend concentration and material CPA efficiency differences across
breakdown values.

**Protected characteristics:** `age` and `gender` are `PROTECTED_DIMENSIONS`. They may be reported for
transparency, but the analysis never produces an actionable "exclude group X" recommendation on them
(`actionable = false`), and mixed-currency breakdown rows are not efficiency-compared. This avoids
discriminatory recommendations.
