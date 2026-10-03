# 14 — Benchmark Results (executable)

Measured by `test/benchmark.test.ts` over `lib/markting/orchestrator/benchmark.ts` — each assistant
question is verified by a predicate on the real computed section/diagnosis; no question counts on backend
existence alone.

| | Coherence-1 | Coherence-2 |
|---|---|---|
| **ANSWERABLE_NOW** | 12/50 | **42/50** |
| via product surface | 10 | 10 |
| via Assistant (orchestrator) | 2 | 32 |
| agent-only (raw provider reads) | — | 7 |
| not supported | — | 1 |

**PASS: 42 ≥ 40.** The 8 not-now: #23 search terms, #24 negatives suggestion, #25 impression share,
#26 PMax asset groups, #29 bid-strategy change, #30 create campaign, #31 launch RSA (all raw provider
reads/writes reachable only via an MCP agent today), and #36 attribution-window sensitivity (no surfaced
control).

**Honest caveat:** every newly-answerable analytical question is computed over **synthetic demo data**
(the seed portfolio); the *product path* (orchestrator → Assistant/surfaces) is genuinely reachable, but
the *content* for a live account needs live provider/commerce connections, which are BLOCKED_EXTERNAL.
No question was marked answerable on backend existence alone — each assistant check asserts the real
computed section or composed diagnosis.

## Acceptance-check hardening (panel-driven)
After an independent panel noted ~14 assistant checks were presence-only (would pass on an empty-but-
present section), they were tightened to assert a real computed property: allocation conservation
(totalMoved+unallocated==extra), forecast estimate>0, cross-channel comparability state + ranking/reasons,
anomaly report points processed, scaling per-row state present, commerce available+margin present, creative
rows>0, trend direction defined. The 42/50 count is unchanged (the seed genuinely populates these), but a
regression that emptied a computation would now fail the benchmark.
