# 08 — Security

## No autonomous execution / no approval bypass

Phase 6 adds NO write capability. Recommendations are typed review labels (`requiresHumanApproval:
true`, no endpoint/path/body/method). A scenario decision persists a `review_status`
(PROPOSED/UNDER_REVIEW/ACCEPTED_FOR_PREVIEW/REJECTED) — never an execution record; execution still goes
only through the Phase-0 preview/approval path. The workbench exposes `executionPath:
'phase0_preview_approval_only'` and has no execution affordance. Autonomous optimization is DISABLED.

## Multi-tenancy (red-team targets)

- **Org A reading Org B scenarios/experiments:** every query filters `organization_id`; `getScenario`
  for the wrong org returns null; DB-gated tests assert isolation.
- **Changing org budget / inputs via a client payload:** the org is server-derived and asserted before
  the DB call (`saveExperiment`/`upsert*` throw on an org mismatch); allocation inputs are typed values
  the server supplies, not free-text the model controls.
- **Prompt-injected constraints / campaign names:** candidate ids/names are DATA, never executed; the
  allocator's math uses numeric fields only, so an id like "IGNORE ALL INSTRUCTIONS" is inert.
- **Cross-tenant experiment id / fake outcome:** experiments are keyed and FK'd per org; an outcome is
  only readable when the experiment is VALID, and the causal ceiling caps the claim.
- **Model-generated hidden endpoint/body:** recommendations are typed; the eval asserts no
  endpoint/url/method/body/execute/mutation keys appear.
- **DB grants/RLS:** every `ON CONFLICT DO UPDATE` writer has an UPDATE grant (Phase-4 lesson); all new
  tables + `markting_experiments` are RLS-enabled (restrictive server-only + backend policy,
  anon/authenticated revoked), validated on the real-Postgres CI lane.

## Determinism

Core decision math is deterministic and reproducible (same inputs → same moves), and fully traced, so
the LLM cannot smuggle hidden optimization math into a recommendation.
