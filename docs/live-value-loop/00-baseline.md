# 00 — Phase A Baseline

Starting point (HEAD `60dba57`, council verdict PROMISING — NOT YET GLOBALLY COMPETITIVE). The decisive
gap: **no live value loop** — `lib/cloud/intelligence.ts` chose a binary `demoGatherer` (synthetic seed) or
`emptyGatherer` (NOT_CONNECTED); the real computed engine `analyzeAccount` existed and was tested but was
wired into NO surface. So on a real connected account the flagship intelligence surfaces rendered empty.

Phase A scope (ONLY): A1 blended-conversions headline, A2 canonical money formatting, A3 tenant audit
append-only, A4 live ReportRow→MetricObservation gatherer, A5 computed flagship diagnosis, A6 date-range +
timezone + freshness. Explicitly NOT in scope and left OFF: Mode B provider writes, autonomous optimization,
live AI model, creative multimodal, SSO/SAML/SCIM, KMS, MMM, incrementality, new admin/connection engines.

Grounding: three code-mapping audits established exact seams (gatherer, money, audit/date) before any edit;
all changes reuse existing canonical modules (`MetricObservation`, `normalizeReportRows`, `analyzeAccount`,
the orchestrator) — no parallel pipeline.
