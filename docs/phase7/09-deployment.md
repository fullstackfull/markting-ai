# 09 — Deployment & Migration Safety (7Q)

Production deployment strategy (design, consistent with the forward-only migration discipline used
throughout):

- Ordering: run migrations FIRST (or in a compatible rollout order) so new code never hits an old
  schema. Every migration is forward-only, additive, and tested from the previous production schema in
  the CI `cloud-db` lane (no destructive reset — the lane applies migrations onto a persisted volume).
- Rolling deployment with health/readiness checks; old and new app versions must be schema-compatible
  during the overlap.
- Rollback: redeploy the previous app version (the schema stays forward-compatible); never a
  destructive DB reset.
- High-risk table changes use the EXPAND/CONTRACT pattern: add new columns/tables (expand), backfill +
  dual-write, switch reads, then drop the old shape in a later migration (contract) — each step
  forward-only and lock-impact assessed.
- CI gates deployment: all six lanes (node, cloud-db real-Postgres, engine, drift, infra, security)
  must be green.

## TLS / network security (7M) — design

TLS at the edge; secure internal transport; database network restriction (no public DB); model-provider
egress controls + a provider-API egress allowlist where practical; admin surfaces protected; no
unnecessary public engine port. These are production topology requirements, documented here.
