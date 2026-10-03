# 03 — Media Buyer Workspace (Needs Attention) — DONE (core), PARTIAL (sections)

`app/dashboard/workspace/page.tsx` (`/dashboard/workspace`, nav: "Needs attention") — a reachable server
component that renders the composed `IntelligenceResult` from the orchestrator:

- **Diagnosis** card: the composed bilingual headline + the single next action (toned chip) + the
  trust tier + the honest answer source + a "Demo / synthetic data" marker when the data is not live +
  the next best question.
- **Contributing factors (ranked)**: one card per factor (domain, severity, confidence, trust,
  materiality, deterministic priority) — the cross-domain story, not a bag of disconnected findings.
- **Recommendations**: a preview table linking to the Recommendation Center.
- **Domain coverage**: explicit CONTRIBUTED / NOT_CONNECTED / NO_SIGNAL per domain (honest empty state).

Bilingual/RTL via `BiText` + locale (no fake content). Verified present by `next build`; the composition
it renders is covered by the orchestrator + assistant-service tests.

## Status

- **DONE:** the attention/diagnosis surface exists and is reachable, and answers "what needs attention /
  what changed / why / what to do first" from the unified orchestrator (demo data today; live data
  `BLOCKED_EXTERNAL`).
- **PARTIAL:** the full section set named in Program 4 (separate Opportunities / Monitoring / Data
  Issues / Recent Decisions / Outcome Follow-ups lanes, and a priority queue spanning many accounts) is
  represented today as the single ranked-factor + recommendations view. The multi-lane layout and a
  cross-account priority queue remain.
- **NOT_STARTED:** a dedicated Morning Brief composition surface (the brief engine exists; it is not yet
  wired to its own page — the Workspace diagnosis is the closest reachable surface today).
