# 02 — Canonical marketing model

`platform/apps/cloud/lib/markting/intelligence/model.ts`. Canonical core entities + provider-specific
extensions; raw provider ids and source are always preserved; original values kept where
normalization is lossy (`MetricObservation.raw`).

## Entities
Organization, Workspace, Brand, AdConnection, AdAccount, Campaign, AdGroup, Ad, Creative, Audience,
Placement, RevenueSignal, and the central `MetricObservation`. Each entity ref carries `rawId`,
`sourceProvider`, `accountId`, and a namespaced canonical `id` (`provider:account:rawId`).

## Metrics
Canonical vocabulary: spend, impressions, reach, frequency, clicks, ctr, cpc, cpm, conversions,
conversion_value, cpa, roas, plus funnel/engagement extensions (video_views, engagement,
landing_page_views, add_to_cart, checkout, purchase, lead). Ratio metrics (ctr/cpc/cpm/cpa/roas/
frequency) are flagged and are NEVER summed — they are recomputed from base totals.

## Every observation carries
provider, account, entity level, date range, timezone, currency (when monetary), attribution basis,
freshness (read-at), and a `DataTrust` block (tier/source/sampleSize/complete/validated). Incompatible
attribution is never merged silently; FX is never inferred.

Tested in `platform/apps/cloud/test/intelligence.test.ts`.
