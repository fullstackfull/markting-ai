# 09 — System Health & Jobs (PARTIAL / roadmap)
Job tables (`markting_observation_jobs`, `markting_reconciliation_jobs`) exist but have no runner; there is no
/health endpoint. An operator jobs/queue/dead-letter view + a runner are roadmap Wave 12; `/admin/system` is a PARTIAL
stub that states this honestly rather than showing fake status. A provider-write job may never be manually replayed
outside the Phase-0 execution/idempotency contract.
