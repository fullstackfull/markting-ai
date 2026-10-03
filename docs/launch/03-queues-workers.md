# 03 — Durable Queues / Workers (Stage 6)

## Proven
The single-winner LEASE used for provider operations is a true atomic claim — a conditional single-row
UPDATE (`ops/store.claimOperation`) proven on real Postgres (two concurrent claims → exactly one wins).
State transitions are compare-and-swap (`transitionOperation`), so a worker crash mid-apply cannot be
last-writer-clobbered; a lost result goes to UNKNOWN_RESULT and only advances with reconciliation
evidence. FAILED has no auto-retry; dead-letters are recorded (commerce sync) as events.

## BLOCKED_EXTERNAL
A durable queue BACKEND (pg-boss/Redis/SQS) and a worker host are not provisioned here. The job kinds
(provider sync, AI jobs, reports, observation jobs, provider reconciliation, notifications) are defined;
their business logic is tested; graceful-shutdown + lease-expiry semantics are designed (`docs/phase7/06`).
No production-critical queue is process-local in the design — the Postgres-backed claim/lease is the
cluster-safe primitive; wiring the queue runner is a deploy-time step.
