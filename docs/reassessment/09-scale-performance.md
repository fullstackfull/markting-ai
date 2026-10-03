# 09 — Scale & Performance Assessment

**Lens:** performance / infra engineer. **Method:** static reading of store/query/index code @
`affdecc`, against theoretical production volumes (100k campaigns/org, 1M orders, 100k creatives,
10k orgs). Tags: `VERIFIED_CODE` / `PARTIAL` / `MISSING`.

## Important context

The heavy engines (`clusterCreatives`, `productStats`, `creativeCommerceLinks`, `effectivenessRows` →
dashboard) are currently invoked **only from `test/`** — no production route wires them. So these are
**latent gaps that detonate the moment a dashboard/route is wired**, not live incidents. One thing is
genuinely well-built: `optimize/allocation.ts` and the observation-job queue (see "what survives").

## Top 10 scale/performance gaps

1. **[P0] `effectivenessRows` loads THREE full tables per org into memory and joins in JS.**
   `decision-store.ts` issues three `select ... where organization_id = ?` with **no LIMIT**
   (recommendations, decision_events, recommendation_outcomes), then builds Maps and `.map()`s the whole
   recommendation set — the input to the outcome dashboard. At 100k campaigns/org, decision_events is
   hundreds of thousands of rows, all streamed into Node per dashboard load. Unbounded memory/latency.
   `VERIFIED_CODE`.
2. **[P0] `upsertOrders` is a delete + N-insert N+1 loop, fully sequential, no transaction.**
   `commerce/store.ts`: per order one upsert, then `delete ... order_lines where order_id`, then a
   per-line INSERT loop — all awaited serially, re-deleting+re-inserting all lines every resync. A crash
   mid-loop leaves an order with zero lines. Worst write path at commerce volume. `VERIFIED_CODE`.
3. **[P0] Zero caching anywhere.** No `unstable_cache`/`revalidate`/redis/LRU/memoize in `lib/markting`.
   No materialized rollups, no cached ledger. Combined with #1, each dashboard view re-runs the
   three-table scan + JS join from scratch. (`countOutcomes` does a proper SQL `group by` — but the
   dashboard doesn't use it.) `MISSING`.
4. **[P1] Analysis engines silently truncate at a 5000-row cap with `select *`.** `listOrderRows`
   (default 5000) and `listCreatives` (hard 5000) pull wide JSONB columns; at 1M orders / 100k creatives
   `productStats` and `clusterCreatives` only ever see the newest 5000 — analysis computed on a
   silently-wrong truncated dataset with no "incomplete" flag. Raising the cap trades truncation for
   OOM; neither engine does windowed/streamed aggregation. `VERIFIED_CODE`.
5. **[P1] Missing index for `listCreatives`' own sort key.** Query orders `updated_at desc`; only
   `(organization_id, account_id)` and `(organization_id, campaign_id)` indexes exist — no
   `(organization_id, updated_at desc)`, so the org-only call sorts the whole partition. `PARTIAL`.
6. **[P1] `listTimelineEvents` unbounded AND ordered ascending.** `decision-store.ts`: no LIMIT, `order
   by occurred_at asc` while the index is `... desc`; without `sinceIso` it loads the account's full
   history oldest-first. `VERIFIED_CODE`.
7. **[P1] `listOutcomes` unbounded.** `outcome-store.ts`: `order by created_at desc`, no LIMIT; the
   available index leads with `classification`, so the org-wide call can't use it for the sort → full
   partition scan+sort. `PARTIAL`.
8. **[P2] `listMemory` unbounded + post-filters `activeOnly` in JS** — ships revoked/stale rows over the
   wire and scans the whole org's memory per read. `VERIFIED_CODE`.
9. **[P2] Secondary N+1 write loops** — `upsertCreative` (per-asset), `saveCluster` (per-membership; at
   100k-creative clusters = 100k round-trips), `upsertRefunds`, `upsertProducts`; none batched.
   `VERIFIED_CODE`.
10. **[P2] Observation-job worker: global `limit 50`, no per-org fairness.** `claimDueJobs` is correctly
    durable (`for update skip locked`, CAS, partial index) but claims 50 jobs globally with no tenant
    quota — one backlogged org starves the other 9,999. Separately `listOrderRows` orders by
    `created_at_src desc` while the only orders index has `store_id` in the middle, so the store-less
    call sorts the partition (missing `(organization_id, created_at_src desc)`). `PARTIAL`.

## Caching / Queue / Per-request summary

- **Caching:** NONE (P0-3).
- **Queue:** the outcome-observation queue is **durable and DB-backed** (`markting_observation_jobs` +
  `FOR UPDATE SKIP LOCKED` + bounded retries) — good. Weaknesses: single global batch of 50, no per-org
  fairness, polling-based. No general-purpose durable queue for ingestion/analysis fan-out.
- **Per-dashboard cost:** recomputes everything per load (P0-1 + P0-3); no rollup table/cached ledger.

## What survives production volume (call out as good)

- `optimize/allocation.ts` — explicitly bounded `O(N log N + steps)`, hard guard counters prevent
  runaway loops, operates on a caller-supplied candidate array not a DB scan. Safe.
- `clusterCreatives` algorithm is honest `O(N)` single-pass bucketing — the problem is only its
  truncated 5000-row input (#4), not the algorithm.
- Governance stores (`ops/store.ts`) — CAS single-row UPDATEs; `listOperations` capped and selects 4
  columns (not `select *`). Main risk is just that 5000 cap at >5000 operations.
- `countOutcomes` uses SQL `group by` — the right pattern the dashboard should have used.

## Highest-leverage fixes (for the next program, not this mission)

1. Replace `effectivenessRows` + per-request ledger build with SQL aggregation / materialized rollup,
   and cache it (kills P0-1 + P0-3).
2. Batch `upsertOrders` lines into multi-row INSERTs inside a transaction; skip line delete+reinsert
   when unchanged (P0-2).
3. Add real pagination + "incomplete" signaling and make `productStats`/`clusterCreatives` windowed
   (P1-4).
4. Add the missing sort-key indexes (P1-5/6/7, P2-10).

## Net

The write-safety/governance stores and the allocation engine are built for scale; the **analytics read
paths and commerce ingestion are not** (full-table scans, JS joins, N+1 writes, silent truncation, zero
caching). Because these paths are not yet wired to a surface, none is a live incident — but every one is
a release-blocker for the surface that wires them.
