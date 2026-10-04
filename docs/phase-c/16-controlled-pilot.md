# C22 — Controlled pilot DESIGN (not launched)

This is a **design**. No pilot is launched, no write is enabled, Mode B stays HELD. It documents how a
controlled write pilot WOULD run once live credentials exist and the Mode-B readiness review
(`15-mode-b-readiness.md`) clears every production gate.

## Scope (minimal, reversible only)

- Only the three allowlisted actions: `SET_DAILY_BUDGET`, `PAUSE_ENTITY`, `RESUME_ENTITY`. No new write
  types are introduced for the pilot.
- `RESUME_ENTITY` is excluded from the first pilot wave (no rollback strategy — pilot-capped per C21).
- Budget moves are capped at the allowlist's ±50% single-step delta; no account-level or destructive
  actions.

## Blast-radius limits

- One consenting pilot organization, one provider, a small number of explicitly enrolled entities.
- A per-pilot daily budget-change ceiling and a maximum number of governed actions per day.
- Every action flows the full Phase-0 path: recommendation → typed action → policy validation →
  immutable preview → **human approval** → apply-time revalidation → atomic claim → provider write →
  result → audit → outcome. No autonomous action.

## Abort criteria (kill-switch wired)

- Any apply-time revalidation mismatch (ownership/entity/currency/current-value) aborts that action.
- An `unknown_result` is reconciled, never blind-retried (`ops/idempotency.ts`).
- A spend anomaly, an error-rate threshold, or operator judgment trips the kill-switch
  (`ops/kill-switch.ts`) at the ACCOUNT / PROVIDER / ACTION_TYPE scope, halting the pilot immediately.

## Observability + rollback

- The 7-stage write trace (`ops/observability.ts`) and write-success/failure metrics are recorded per
  action; alert rules (`high_ai_cost`, `write_failure`, `kill_switch_triggered`) watch the pilot.
  (Alert **delivery** is an outstanding gate — see `13-observability.md`.)
- Rollback: `restore_previous_value` (budget) / `resume_if_was_active` (pause), captured in the
  immutable preview so the prior state is always known.

## Entry gate

The pilot may start only when `currentModeBReadiness()` reports every action at least
`READY_FOR_CONTROLLED_PILOT` AND the production gates (`liveWriteVerified`, `observabilityDelivered`,
this design signed off) are `MET`. Today `liveWriteVerified` is BLOCKED_EXTERNAL and delivery is NOT_MET,
so **the pilot cannot start** — by design.

**Status:** designed; not launched. Entry gate blocked (live write verification BLOCKED_EXTERNAL).
