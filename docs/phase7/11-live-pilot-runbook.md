# 11 — Controlled Live-Write Pilot Runbook (7Z)

A live pilot is NOT performed: live provider OAuth/write credentials and explicit environment
authorization are absent (BLOCKED_EXTERNAL). This is the exact runbook to execute once a dedicated test
ad account, live credentials, and written authorization exist. Nothing here runs automatically.

## Preconditions
- `MARKTING_RUNTIME_MODE=LIVE_WRITE_APPROVAL_ONLY`.
- One dedicated TEST ad account, one low-risk campaign, small financial exposure.
- A human REQUESTER and a DIFFERENT human APPROVER (4-eyes; a senior approver if the account is
  protected).
- Provider health = CONNECTED; no active kill switch for the scope.
- One reversible typed action: `SET_DAILY_BUDGET` (small ± within the 50% cap).

## Steps
1. **Baseline** — fetch and record the current provider state (budget, status, currency, ownership).
2. **Preview** — generate the typed action → policy validation → immutable preview (operation digest,
   before-state, approval expiry). Confirm the client-identity banner names the correct account.
3. **Approval** — the approver (≠ requester) approves in the Approval Center; quorum satisfied.
4. **Apply** — apply-time revalidation (`revalidateAtApply`) MUST pass; atomic claim; provider write
   with the idempotency key where supported.
5. **Verify provider state** — fetch the entity; confirm it equals the intended state → mark
   APPLIED_CONFIRMED (if the response was lost, run reconciliation).
6. **Verify audit** — the operation ledger + audit_events record requester, approver(s), policy,
   digest, before/after, provider request/result, timestamps, trace id.
7. **Verify outcome link** — the operation references the recommendation and an outcome observation job.
8. **Rollback** — build the rollback as a NEW governed operation (restore the exact previous budget);
   preview → approve → apply.
9. **Verify rollback** — fetch the entity; confirm the previous value is restored; audit the rollback.

## Abort conditions
Any REPREVIEW_REQUIRED/EXPIRED, provider health ≠ CONNECTED/DEGRADED, kill switch active, or
UNKNOWN_RESULT without reconciliation evidence → STOP and do not retry blindly.
