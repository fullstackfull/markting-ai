# 02 — Experiment Design & Outcome Linkage

## Design flow

A design pairs a structured `Hypothesis` with explicit `ControlArm`/`TreatmentArm`, a `SampleRequirement`,
guardrail metrics, an observation window, and an assignment method that fixes the honest study type.
`READY_FOR_REVIEW` requires a sufficient sample design (`assessSample`); otherwise the design stays
`DRAFT` / `EXPERIMENT_NOT_READY`. Launch requires a HUMAN (`APPROVED_FOR_LAUNCH`) via the Phase-0 path —
the engine never launches.

## Outcome engine (`optimize/outcome.ts`)

`evaluateExperimentOutcome` reuses the Phase-3 outcome logic and layers experiment validity + the causal
ceiling. An experiment that is CONTAMINATED/INVALIDATED/INCONCLUSIVE yields no readable result; a VALID
experiment produces an outcome whose causal claim never exceeds the study's ceiling (a before/after can
reach at most `TEMPORAL_ASSOCIATION`). The experiment RESULT is explicitly distinguished from a
recommendation RESULT.

## Learning from experiments

Structured experiment results may inform recommendation context, the playbook, and historical patterns
(reusing Phase-3 memory, sample-gated). They do NOT automatically rewrite optimization policy —
human-approved configuration remains authoritative.

## Experiment calendar (`optimize/workbench.ts`)

Views planned / running (with observation-window end) / completed / invalidated experiments. Launches
are never scheduled automatically — the calendar states this explicitly.
