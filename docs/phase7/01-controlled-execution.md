# 01 — Controlled Execution (7A/7C/7D/7E)

## Action allowlist (7A) — `ops/actions.ts`

Only three typed actions are production-eligible: `SET_DAILY_BUDGET`, `PAUSE_ENTITY`, `RESUME_ENTITY`.
Each defines supported providers, risk class, required permission, reversibility, rollback strategy,
max single-step delta (budget ≤ ±50%), required data trust, and required live-state checks. Unknown
actions FAIL CLOSED (`resolveAction` → UNKNOWN_ACTION). Deletion, arbitrary mutation, targeting
rewrite, creative publishing, bid-strategy migration, and account-level destructive actions are NOT
enabled.

## Execution state machine (7C) — `ops/state-machine.ts`

16 states (DRAFT → PREVIEWED → PENDING_APPROVAL → PARTIALLY_APPROVED → APPROVED → CLAIMED → APPLYING →
APPLIED/FAILED/UNKNOWN_RESULT, plus EXPIRED/SUPERSEDED/REJECTED/CANCELLED/ROLLBACK_REQUESTED/
ROLLED_BACK). `assertTransition` refuses illegal transitions SERVER-SIDE (e.g. APPROVED→APPLIED is
illegal — you must CLAIM then APPLY). Every store state write passes through the guard.

## Idempotency + UNKNOWN_RESULT (7D/7Y) — `ops/idempotency.ts`

A deterministic operation digest identifies the exact approved action. Exactly-once is claimed ONLY
where the provider supports an idempotency key (google/sandbox); elsewhere we rely on a local ATOMIC
CLAIM + immutable identity + post-failure reconciliation and NEVER blindly resend. When a write's
result is unknown (timeout/drop), the operation goes to UNKNOWN_RESULT; `reconcileUnknownResult`
compares intended vs the provider's fetched state → APPLIED_CONFIRMED (no retry) / SAFE_TO_RETRY (only
if still at the pre-change value) / STILL_UNKNOWN (never a blind resend).

## Atomic claim — `ops/store.ts#claimOperation`

A conditional single-row UPDATE (`... set state='CLAIMED', claim_token=$ where state='APPROVED' and
claim_token is null returning ...`). Only one worker can ever win; a second concurrent claim gets no
row back (proven in the DB-gated concurrency test).

## Rollback (7E) — `ops/rollback.ts`

No magic external-API rollback. A rollback is a NEW governed action (its own preview → approval →
apply → audit): budget restores the exact previous value; pause resumes ONLY if the captured prior
state proves the entity was ACTIVE; resume is not auto-rolled back.
