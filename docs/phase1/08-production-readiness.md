# 08 — Production readiness (Phase 1)

What Gate A/B need beyond the intelligence code, and the honest status of each in this sandbox.

| Area | Status | Note |
|---|---|---|
| Root CI (incl. DB-gated suites) | BUILT, not run here | `.github/workflows/ci.yml`; first green run must be confirmed on GitHub (no runner in sandbox) |
| DB-backed tests | NOT run here | Docker/Supabase down; `pending-claim`, `markting-repository` (+ thread-turn), isolation suites run in CI |
| Next.js image advisory | BLOCKER (unchanged) | 16.3.1 reachable same-origin only; patch bump is a deploy-pipeline step (needs registry + full build/e2e) |
| TLS edge | RUNBOOK | deploy contract; not provisionable here |
| Secrets / KMS | RUNBOOK | `ADPORT_CLOUD_ENCRYPTION_KEY` in a KMS; `MARKTING_ENGINE_TOKEN` per env; no NEXT_PUBLIC leak (verified) |
| Backup/restore | RUNBOOK | adport DB + engine pma_* DB; drill required |
| Graceful shutdown/drain | RUNBOOK | deploy concern |
| Health/readiness | PARTIAL | engine `/health` + `/markting/info`; cloud readiness is a deploy add |
| Observability baseline | PARTIAL | usage ledger (model), audit log (writes); structured AI traces are request_id/org-correlatable via the ledger; metrics/alerts are deploy-pipeline |
| AI cost metering | BUILT | usage ledger + quotas (06); token accuracy when the model layer reports tokens |
| Provider connection health | BUILT (path) + RUNBOOK | credential validation / ownership / read-permission checks happen at OAuth connect; a real account cannot be connected here |

## FIXTURE vs SANDBOX vs LIVE
The dataset label rides on the analysis context (`DatasetLabel`), the runtime mode is explicit
(`runtime-mode.ts`), and SYNTHETIC trust isolates fixtures from live tiers. Fixture and live values
are never mixed in one analysis unless explicitly requested and labeled (the normalizer stamps one
tier per read).

## Security cleanup relevant to Gate A/B
Addressed/held in Phase 0/1: single write path, read-only tool capability, per-org engine report
isolation, tenant-scoped queries, thread serialization, usage quotas. Deferred (not blocking read-only
analysis, scheduled next): MCP token reuse/revocation cascade, CSRF tokens on cookie routes, DB-level
RLS backstop, encryption-key rotation keyring, externalized report index/kill switch. These are
tracked from the audit (SEC-06/14/16/18/27) and the Phase-0 exit; they gate scaled multi-tenant live
operation, not the read-only analysis foundation.
