# 09 — Controlled Write + Rollback Pilot (Stages 12/13/14)

Live provider write is NOT performed (no test ad account, no approved credentials, no explicit
environment authorization) → Gate 11 HELD. The full governance machinery is exercised against a
SANDBOX provider adapter (`test/launch-pilot.test.ts`) and, for the atomic claim + persistence, against
real Postgres (`test/launch.database.test.ts`).

## Exercised (sandbox / real Postgres)
- Happy path: read current → recommendation → typed action → validate → immutable preview + digest →
  quorum (requester ≠ approver) → apply-time revalidation (required live checks enforced) → ATOMIC
  CLAIM (single-winner, real Postgres) → sandbox write → fetch + confirm actual value.
- Rollback (Stage 13): a NEW governed action restoring the exact previous budget → validate → preview →
  (approval) → sandbox apply → confirm restored.
- Failure pilot (Stage 14): timeout BEFORE dispatch → SAFE_TO_RETRY; timeout AFTER dispatch →
  APPLIED_CONFIRMED (no blind resend); stale preview / external budget change → REPREVIEW_REQUIRED;
  expired approval → EXPIRED; provider auth expiry (entity not found) → REPREVIEW_REQUIRED; duplicate
  apply → second claim fails. UNKNOWN_RESULT → APPLIED requires a reconciliation verdict (evidence-gated).

## HELD
The identical chain against a LIVE provider (steps 9–13 of the runbook in `docs/phase7/11`) requires
credentials + authorization. The runbook is ready; nothing is faked.
