# 04 — Live ReportRow → MetricObservation Gatherer (A4)

The highest-value task: wire live provider data into the existing intelligence engine with NO parallel
pipeline.

**Flow (`lib/cloud/live-gatherer.ts`):** provider adapter → `readReportRows` (account + campaign levels, for
the current AND previous windows) → `validateReportRow` → `normalizeReportRows` (tier `PLATFORM_REPORTED`) →
canonical `MetricObservation[]` → `analyzeAccount` (the real deterministic engine) → mapped to the
orchestrator's `GatheredIntelligence` media slice. Reuses `MetricObservation`, `normalizeReportRows`,
`analyzeAccount`, and the orchestrator — no new analytics path, no new observation table (read-through,
computed in-memory per request → no N+1 writes).

**Wiring (`lib/cloud/intelligence.ts`):** `serviceForMode` now routes DEMO → the clearly-SYNTHETIC demo
gatherer; a live deployment → `createLiveGatherer(principal, range)`. When nothing is connected (or zero
rows) the live gatherer **degrades to the honest NOT_CONNECTED empty state** — never demo content.

**Generalized read (`lib/cloud/reads.ts#readReportRows`):** any entity level + any concrete window (so the
previous comparison window and account level are reachable), metrics include `conversion_value`.

**Source honesty:** live observations carry `PLATFORM_REPORTED` trust with source `<provider>-report` (never
`sandbox-fixture`); the three existing source-isolation guards (mode selection, composed-posture guard,
`assertResultPostureAllowed`) are preserved, so a live surface can never show synthetic data and vice-versa.
