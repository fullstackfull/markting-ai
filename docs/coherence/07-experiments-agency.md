# 07 — Experiments & Agency — PARTIAL / NOT_STARTED

## Experiments (Program 9) — PARTIAL

- The optimize/experiment engines contribute `OPTIMIZE`-domain `UnifiedRecommendation`s (scenario/
  experiment references, never execution endpoints) into the Recommendation Center via the orchestrator.
- The sample-sufficiency math was corrected (Program 17, doc 09) so an experiment-readiness verdict is
  statistically sound before it is surfaced.
- **NOT_STARTED:** a dedicated Experiment Workspace / Scenario Comparison / Budget Review / Constraints /
  Guardrails / Rollback-plan surface (Program 9/9.1). No auto-launch, no provider mutation — unchanged.

## Agency (Program 10) — NOT_STARTED

No agency portfolio layer was built this pass. The orchestrator context carries `workspaceId` and the
`ops/agency.ts` engine exists, but the client switcher, cross-client roll-up, "which client needs
attention" triage, and the currency-safe portfolio view are not implemented. This is a significant
remaining increment and is called out as such (Program 10 is one of the larger unbuilt areas).

**Honest note:** the agency persona remains the least-served by this pass. The orchestrator makes a
per-workspace composition possible, but the portfolio UI and multi-client gathering are future work.
