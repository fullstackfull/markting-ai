# 05 — Outcome Observation Jobs (3R)

`outcome-store.ts`, `markting_observation_jobs`.

Durable, tenant-scoped outcome scheduling — **not** one in-memory timer per recommendation. Scheduling
state is persisted.

- **Idempotent + deduplicated:** `scheduleObservation()` inserts with `dedup_key =
  recommendationId:windowLabel` and `on conflict (organization_id, dedup_key) do nothing`, so
  re-scheduling the same window never creates a duplicate.
- **Atomic claim (retry-safe):** `claimDueJobs()` uses `UPDATE … WHERE status='scheduled' AND
  scheduled_for <= now … FOR UPDATE SKIP LOCKED … RETURNING`, so concurrent workers never double-claim.
  A second claim of a running job returns nothing.
- **Bounded + observable:** `attempts` counter, `last_error`, `claimed_at`; `completeJob()` and
  `rescheduleJob()` (bounded to `maxAttempts`) manage the lifecycle.
- **Cross-tenant-safe:** every job row is organization-tagged; a worker may process all tenants' due
  jobs, but each job's work is performed with `job.organizationId` and only ever touches that org's
  data — a job can never read or write another tenant's rows.

A `recommendedWindows(category)` set (24h/3d/7d/14d per category) drives which windows get scheduled.
