# 02 — Database, Backup & Restore (Stages 4/5)

## Database (Stage 4) — RUNTIME_PROVEN (CI real Postgres)
The CI `cloud-db` lane provisions a real Postgres, applies ALL migrations FORWARD-ONLY from Phase 0
through Phase 7 (plus the commerce + optimization + governance migrations) with no destructive reset,
and runs every DB-gated suite. Verified: RLS on every markting_* table, grants (UPDATE only where
upserts; append-only tables select/insert), composite FKs, indexes on hot lookups, backend role
(`adport_backend`) isolation, and cross-tenant isolation across Phases 3–7. Connection pooling,
statement timeout, and connection limits are managed-Postgres settings applied at deploy.

## Backup / Restore drill (Stage 5) — logical drill RUNTIME_PROVEN; cluster restore BLOCKED_EXTERNAL
`test/launch.database.test.ts` performs a genuine logical restore drill on the live schema:
1. create 5 known operation records for org A.
2. back them up (`create table launch_drill_bak as select … where org = A`).
3. delete org A's rows (verify 0 remain).
4. restore from the backup (verify 5 restored).
5. verify RLS: org B's backend-scoped reader sees NONE of org A's restored rows.
6. duration recorded.
This proves data + tenant-isolation integrity of a restore. A full CLUSTER restore (pg_restore of a
managed snapshot) is BLOCKED_EXTERNAL — no managed backup infra in this container; the production
procedure (PITR + daily dumps, RPO ≤ 5 min, RTO ≤ 60 min, scheduled drill) is in `docs/phase7/08`.
