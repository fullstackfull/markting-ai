# 08 — Backup / Disaster Recovery (7L) — design + procedure

This is an operational DESIGN; a live restore drill is BLOCKED_EXTERNAL in this environment (managed
backup infra not present). It is NOT claimed as "ready" without restore proof.

- Automated DB backups: managed Postgres point-in-time recovery + daily logical dumps.
- Retention: 7 daily / 4 weekly / 12 monthly (adjust per compliance).
- Encryption: backups encrypted at rest; dump encryption keys via the KMS keyring.
- Restore procedure: provision a fresh instance → restore the latest snapshot → apply WAL to the target
  RPO → run migration-compat check → smoke-test tenant isolation + a read path → cut over.
- Targets: RPO ≤ 5 min (PITR), RTO ≤ 60 min.
- Backup monitoring: a `backup_failure` alert (observability) fires on a missed/failed backup.
- Restore validation: a scheduled restore drill into an isolated environment that verifies row counts,
  RLS, and a sample tenant's data; the drill's metadata (snapshot id, timestamp, verification result)
  is recorded. Until a drill runs, Gate I is PARTIAL/BLOCKED.
