# C9 — Data freshness SLO

## Built + tested

`lib/markting/ops/freshness.ts` adds the explicit freshness-tier taxonomy the product lacked:

- **Tiers**: `NEAR_REALTIME`, `HOURLY`, `DAILY`, `ON_DEMAND` (`FRESHNESS_TIERS`).
- **Budgets** (`FRESHNESS_BUDGETS`): each tier has a `freshWithinMinutes` and a `staleAfterMinutes`
  (null for `ON_DEMAND` — it is fresh only at the moment it is pulled and never auto-goes stale).
- **`classifyFreshness(tier, readAt, now)`** → `FRESH | AGING | STALE | UNKNOWN`. It **fails honest**:
  a missing/unparseable `readAt` yields `UNKNOWN` (never `FRESH`, `withinSlo:false`); clock-skew (future
  `readAt`) is treated as age 0.
- **`DOMAIN_FRESHNESS`** assigns a tier per domain grounded in how data is actually sourced today: ads
  and breakdowns are `ON_DEMAND` (no background refresh job exists — `AD_DEFAULTS.sync=false` in the
  registry), commerce-webhook is `NEAR_REALTIME`, commerce-sync is `HOURLY`.
- `freshnessLabel` renders a bilingual `state · cadence · age` string for the surface.

This complements the existing `FreshnessBar` (which discloses window/compare/timezone/source/last-refresh)
and the observability `SLO_TARGETS.read_sync_freshness_minutes`; the tier state is an explicit SLO
posture, not an implied real-time guarantee.

Tests: `test/freshness.test.ts` (8) — per-tier thresholds, honest UNKNOWN, skew, labels, domain tiers.

## Honest posture

Because ad reads are on-demand (no background sync job is live — see `08-sync-worker.md`), the honest
freshness for media today is `ON_DEMAND`: fresh at pull, `AGING` thereafter. A live sync worker + a
mounted commerce webhook (both BLOCKED_EXTERNAL) are what would move commerce to `NEAR_REALTIME`/`HOURLY`
in practice.

**Status:** taxonomy + classifier implemented + tested; live freshness depends on the
BLOCKED_EXTERNAL sync worker / webhook route.
