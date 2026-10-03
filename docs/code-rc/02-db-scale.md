# 02 — DB query-path audit, N+1 fixes, indexes, budgets, perf (Programs 5–12)

## Query-path audit (Program 5)
The dashboard intelligence surfaces read through the bounded context gatherer, not per-row queries. The
commerce/ops read paths were audited by reading the SQL:
- `listOrderRows` / `loadCostBook` — single windowed/`distinct on` reads, indexed.
- `listOperations` — single windowed read (now explicitly bounded; see Program 7 in doc 01-equivalent).
- recommendation/outcome history, creative aggregation, agency portfolio — single indexed reads per org.
The one genuine N+1 was commerce **order ingestion**.

## N+1 fix (Program 6)
`lib/markting/commerce/store.ts::upsertOrders` previously issued one INSERT per order line in a loop
(N round-trips per order). It now batches each order's lines into a single multi-row insert
(postgres.js bulk helper), preserving the delete-then-insert resync semantics. Verified by the
`phase5-commerce` DB suite in the `cloud-db` CI lane.

## Indexes (Program 8)
Evidence-based review found the hot paths already carry the right tenant-scoped composite indexes:
`markting_orders (org, store_id, created_at_src)` and `(org, customer_pseudo_id)`;
`markting_recommendations (org, status)` and `(org, entity)`; `markting_operations (org, state,
created_at)` and `(org, account_id)`; `markting_creatives (org, account)` / `(org, campaign)`;
`markting_ai_usage (org, created_at)`; and `markting_order_lines` PK `(org, order_id, line_id)` covers
the resync delete. No speculative indexes were added (the mission's rule).

## Query budgets (Program 9)
`lib/markting/orchestrator/query-budgets.ts` declares per-surface maximum DB round-trips that must be
**independent of account size** (workspace ≤12, account ≤14, campaign ≤10, creative ≤8, commerce ≤12,
agency ≤16, executive ≤16). `withinBudget` is the invariant a regression test / runtime telemetry
asserts; the `gather_duration` telemetry events are the runtime hook.

## Scale fixtures + context-budget + perf (Programs 10/11/12)
- `scale-fixtures.ts` deterministically generates N campaign observations (seeded LCG, realistic
  spread; no committed giant files).
- `test/context-budget.test.ts`: a 10,000-campaign account yields a bounded context (≤10 kept by
  spend-movement contribution, remainder a reported count, truncation surfaced, highest-materiality
  preserved), assembled in well under a second.
- `test/scale-perf.test.ts`: fixture determinism + budget invariants + an in-memory orchestrator perf
  characterization at 100/1k (and 10k under `RUN_PERF=1`), logging timings.

## Honest status
In-memory scale + the bounded gatherer + query budgets + the N+1 fix are done and CI-verified. Precise
DB **p50/p95** under a seeded large dataset is the `RUN_PERF` CI job (not run on every push, and not
faked locally — the dev container has no DB). Gate "DB-path scale materially corrected": the confirmed
N+1 is fixed and the hot paths are indexed + budgeted; full large-dataset DB latency profiling remains a
`RUN_PERF`/live task.
