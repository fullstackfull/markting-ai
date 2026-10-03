# 12 — Support / Operations Runbook (Stage 19)

Procedures (summarized; each references the governing module):

- OAuth expired → provider health = AUTH_EXPIRED (surfaced, not stale "connected"); re-run OAuth; writes
  blocked until reconnected.
- Provider disconnected → health ERROR/DISABLED; `healthAllowsWrite` false; investigate + reconnect.
- AI model unavailable → governed gateway falls back to `local_fallback` (free, deterministic narration);
  calculations unaffected (deterministic engines authoritative).
- Commerce sync delayed → check `markting_commerce_sync_state` checkpoint + dead-letter events; resume
  incremental sync (bounded, idempotent).
- UNKNOWN_RESULT → open/await the reconciliation job; advance to APPLIED only on APPLIED_CONFIRMED; never
  blind-resend.
- Failed write → state FAILED (no auto-retry); diagnose; a new governed operation supersedes.
- Stuck queue → inspect lease/claim; a worker crash leaves CLAIMED/APPLYING recoverable via
  reconciliation; graceful-shutdown releases leases.
- Failed migration → forward-only + CI-tested from prod schema; roll back the app (schema stays
  compatible), fix forward; never destructive reset.
- Backup restore → follow `docs/phase7/08` (PITR + dumps); verify RLS + row counts post-restore.
- KMS rotation → `KeyRing.rotate`; old data still decrypts; background reseal; audit the change.
- Kill switch → set the appropriate scope (GLOBAL/ORG/PROVIDER/ACCOUNT/ACTION_TYPE); writes stop
  immediately, reads continue; every change audited.
- Customer offboarding → deletion_requests + tenant data removal (Phase-0 retention); revoke
  connections + service accounts.
