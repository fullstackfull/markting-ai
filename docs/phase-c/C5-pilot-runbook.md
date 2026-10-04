# C.5 (11) — Controlled pilot RUNBOOK (executable)

This turns the pilot DESIGN (`16-controlled-pilot.md`) into step-by-step operator instructions. It is a
runbook, not an automation: **no stage advances automatically**, Mode B stays HELD, autonomous
optimization stays OFF. A human performs each step and records the result.

## Target

- **1 design partner**, **1 organization**, **1–2 ad accounts**, **Meta + Google** first.
- **Read-only intelligence first.** Provider writes are a separate, later, separately-approved stage.

## Entry preconditions (all must hold before Stage 0)

1. `currentModeBReadiness()` reports every action at least `READY_FOR_CONTROLLED_PILOT`.
2. Pre-live security review (`14-security-review.md`) signed off; no open P0/P1.
3. Sandbox/live credentials supplied for the pilot org only, through the environment (never committed).
4. Kill-switch verified operable at ACCOUNT / PROVIDER / ACTION_TYPE scope.
5. Alert delivery (Platform Admin channel) and `/admin/incidents` confirmed working.
6. `node scripts/live-verify.mjs --provider meta` and `--provider google` run GREEN (read-only harness).

## Stages (manual gate between each)

**Stage 0 — Connection only.** Connect Meta + Google for the pilot org via the Connection Center.
Verify account discovery lists the expected 1–2 accounts and nothing from any other tenant. No reads yet.
Gate: operator confirms the account list is correct and scoped.

**Stage 1 — Live read.** Enable INITIAL then INCREMENTAL sync for the pilot connections only (via the
sync worker; provider cadence per `sync-scheduler.ts`). Confirm normalized rows land as
`PLATFORM_REPORTED`, rejected rows are counted (not silently dropped), and freshness shows the honest
tier. Gate: operator confirms a sample of rows matches the provider's native UI within expected tolerance.

**Stage 2 — Daily diagnosis.** Enable the deterministic daily diagnosis for the pilot account(s).
Confirm every claim carries evidence + confidence + data-trust + time-window, and unresolved items are
surfaced. Gate: media-buyer feedback (`C5-media-buyer-feedback.md`) collected; diagnosis judged correct.

**Stage 3 — AI narration (only if separately approved).** Swap the scripted narrator for the governed
live model narrator (requires model credentials — BLOCKED_EXTERNAL today). Confirm the AI eval rubric
(groundedness/factuality/overclaim/safety) passes and no number appears that is absent from the
structured facts. Gate: AI-safety reviewer sign-off.

**Stage 4 — Controlled provider-write pilot (ONLY after a SEPARATE written approval).** Not part of this
runbook's default scope. Would enable `MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY` for the pilot org
only, with the ±50% budget-delta cap, full approval path, and the abort criteria below. Requires the
Mode-B production gates (`15-mode-b-readiness.md`) all MET.

## Abort criteria (trip the kill-switch + open an incident immediately)

- incorrect money (currency/magnitude mismatch vs native UI)
- any cross-tenant data appearing in the pilot org
- wrong attribution basis presented as comparable
- data staleness beyond the tier SLO (`freshness.ts`)
- provider error-rate spike (alert `PROVIDER_OUTAGE` / `AUTH_FAILURE_SPIKE`)
- any secret leak (token/credential visible anywhere)
- incorrect account ownership (an account resolves to the wrong org)
- an unreconciled write result (`UNKNOWN_RESULT` not resolved by the reconciler)
- kill-switch fails to halt within one tick

On any abort: trip the kill-switch at the narrowest sufficient scope, open an incident
(`/admin/incidents`, reason-required), and do not advance until root-caused and resolved.

## Rollback

Reads have no provider-side effect (read-only). A Stage-4 write rolls back via the action's
`rollbackStrategy` (`restore_previous_value` / `resume_if_was_active`), captured in the immutable preview.
