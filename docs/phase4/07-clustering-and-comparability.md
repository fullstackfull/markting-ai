# 07 — Deduplication, Clustering & Comparability (4M/4N/4P)

## Deduplication (4M) — `creative/dedup.ts`

`relationBetween()` → `EXACT_DUPLICATE / LIKELY_VARIANT / RELATED / DISTINCT`:
- EXACT_DUPLICATE: identical media hash AND identical normalized text.
- LIKELY_VARIANT: same media asset with different copy (a copy test), or same normalized text + same
  account + same media type.
- **RELATED: similar copy but DIFFERENT media** — explicitly NOT merged into a duplicate (the mandate's
  rule: different creatives must not be merged solely because copy is similar). Text similarity is a
  transparent Jaccard over word sets, not an opaque embedding.
- `dedupGroups()` only groups EXACT/LIKELY_VARIANT; RELATED/DISTINCT stay separate.

## Clustering (4N) — `creative/clustering.ts`

**Explainable** clusters by a transparent feature key: `media | hook | angle | format | cta-bucket`.
Every cluster exposes its defining features, member creative ids, sample size (conversions), a
performance summary (via the Phase-2 currency-aware `aggregate`, so monetary ratios are left undefined
on mixed currency), and trust tier. O(N) single-pass bucketing — no O(N²) path. No opaque clusters.

## Comparability (4P) — `creative/performance.ts#creativeComparability`

Gates every creative/cluster comparison on currency / objective / audience(country) / attribution /
date window → `COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE`. Hard blockers (different currency
or objective) force NOT_COMPARABLE; the Ask and dashboard surfaces refuse or caveat comparisons
accordingly, so a video-vs-image or cross-cohort comparison never produces a fake winner.
