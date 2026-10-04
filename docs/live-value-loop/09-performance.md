# 09 — Performance (A9)

The live loop computes observations in-memory per request (no persistence, no per-row DB write), so there is
no N+1 write path. `test/live-loop-perf.test.ts` runs the validate→normalize→`analyzeAccount` path over
**100 / 1,000 / 10,000** campaign rows and asserts: exactly n unique campaigns (no duplication), and bounded
near-linear completion (10k well under the guard; a quadratic regression would blow past it). The provider
read itself is bounded by the report tool's `limit` (default 250) and runs one call per level/window
(account + campaign × current + previous = 4 calls), fanned out with `Promise.all` — not per-campaign.
