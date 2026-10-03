# 10 — Scale & Performance — NOT_STARTED (gated, not yet needed)

Per `docs/reassessment/09-scale-performance.md`, the material scale P0/P1s (the `effectivenessRows`
three-table in-JS join, `upsertOrders` N+1, silent 5000-row truncation, missing sort-key indexes, queue
per-org fairness) are **latent**: they live in read/ingest paths that are still only reached from tests,
not from a production route. The sequencing rule says each is a release-blocker **for the surface that
wires it**.

## Status

- **NOT_STARTED this pass.** The surfaces shipped in Wave 3 (Workspace, Recommendation Center) are driven
  by the orchestrator over a bounded in-memory composition (demo gatherer) or an empty gatherer — they do
  not yet run the heavy `effectivenessRows`/`listOrderRows`/`clusterCreatives` paths against large data,
  so no scale refactor was required to ship them safely.
- **Required before** wiring a live, large-account gatherer (the account drill-down / live gatherer of
  Programs 5/6): replace `effectivenessRows` with SQL aggregation / a materialized rollup + caching;
  batch `upsertOrders` lines in a transaction; add pagination + an "incomplete" signal and windowed
  aggregation; add the `(organization_id, updated_at desc)` / `(organization_id, created_at_src desc)`
  indexes; add per-org queue fairness.

**Honest note:** no synthetic large-account benchmark was run this pass. This is the single most
important prerequisite for a live, high-volume gatherer and is recorded as the top Wave-7 item.
