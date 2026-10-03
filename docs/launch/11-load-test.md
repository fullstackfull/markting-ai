# 11 — Load / Concurrency (Stage 17)

## Exercised (in-process + real-Postgres concurrency)
- Allocation/optimization: 1,000-candidate allocation < 300ms, 10,000-candidate reduction < 600ms
  (Phase-6 perf tests) — bounded, no combinatorial blow-up.
- Concurrency correctness on real Postgres: two concurrent atomic claims → exactly one winner; two
  concurrent legal transitions → CAS single-winner (no lost update). This is the correctness property
  that matters for controlled execution under contention.

## BLOCKED_EXTERNAL
A production-scale load test (multi-org/multi-client concurrent sync + AI + reports + approval queue,
measuring p50/p95/p99, DB load, queue depth, provider/AI latency) needs managed hosting + a load
harness + live backends — not available here. The correctness-under-concurrency primitives are proven;
throughput/latency at scale is unmeasured and must be run against the deployed environment before scale.
