# 12 — Performance & indexes

## Where the work happens
Phase B depth is **in-memory compute** over data already read in one pass:
- The live gatherer reads account/campaign/ad_group/ad in a single `Promise.all` (8 reads total,
  current+previous × 4 levels) — a fixed fan-out, not per-entity. No per-row DB query → **no N+1**.
- `analyzeAccount` descends the tree by filtering already-loaded child arrays on `parentRawId`
  (hash grouping), then runs the same per-entity diagnosis. Linear in the number of entities.
- `applyTableState` filters → sorts → paginates an already-loaded array; bounded page size (≤100) means
  the rendered page is constant-size regardless of row count.
- The DEMO drill-down reads the in-memory seed; no DB round-trip per level.

## Measured (test/pro-depth-perf.test.ts)
- Hierarchy analyze at 100 / ~1k / ~10k entities (campaign→ad_group→ad): completes well under the
  bound, produces exactly the expected node counts, and has **no duplicate/lost entities** — confirming
  no quadratic blow-up between 1k and 10k.
- AnalyticsTable state at 100 / 1k / 10k rows: filter+sort+paginate returns a single bounded page
  (≤25) within the bound. The full table is never materialised to the client.

## Indexes (B20) — added only with evidence
Phase B introduced **no new tenant query path that scans a new column**: the drill-down reads the seed
(DEMO) or the provider report tool (live, not a DB scan), and the table math is in-memory. The existing
per-tenant indexes (`organization_id, created_at desc, id desc` on the hot tables) already cover the
reads the backstop transaction uses. **No new index was added**, because none had query-plan evidence
to justify it — shotgun indexing is explicitly avoided. The tenant RLS backstop predicate keys on
`organization_id`, which is already indexed on every covered table. Should a future phase persist
per-entity observations (a real new scan), index work would be revisited then with `EXPLAIN` evidence.
