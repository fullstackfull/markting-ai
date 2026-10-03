# P0-D Exit — Data ownership & database architecture (R0-09)

Status: ownership mapped and documented; forward-only migration path established; destructive reset
removed from any non-local path and CI validates migrations.

## Two databases, one system of record per domain
- **adport / Supabase Postgres** (SUPABASE_DB_URL) — the authoritative product/business store.
- **engine pma_* Postgres** (DATABASE_URL, compose service `engine-db`) — execution/runtime state only.

| Domain | System of record | Notes |
|---|---|---|
| organizations, users, workspaces, memberships | adport | Supabase auth.users + public tables |
| provider connections, ad accounts, credentials | adport | encrypted vault in private.* |
| operations (pending), approvals, audit records | adport | `pending_operations`, `audit_events` |
| recommendations / engine proposals provenance | adport | `markting_engine_proposals` (bridge record) |
| AI threads (ownership) | adport | `markting_threads` (org/user claim) |
| reports (index + files) | engine host | per-org scoped (P0-C); metadata is execution state |
| model usage / cost | (not yet persisted) | see P0-F; request-count only today |
| engine proposals/approvals/receipts/dedupe | engine pma_* | `pma_proposals`, `pma_approvals`, `pma_receipts`, `pma_dedupe`, `pma_thread_owners` — execution state, not business truth |
| checkpoints (LangGraph) | engine | execution state |
| outcomes | (not yet persisted) | Phase 1+ outcome loop |

**No duplicated authoritative business records.** The engine's `pma_*` rows are execution artifacts;
the adport DB owns the business state (who may spend, what was approved, the audit trail). The bridge
writes the authoritative pending/audit rows in adport; the engine proposal is provenance.

## Consistency / contract
- The single write path (adport PolicyEngine) is the only place an approved mutation is recorded, so
  the audit/pending truth is single-sourced in adport.
- The engine is reached per-request by the cloud; it holds no cross-request business authority.
- Caches: none that retain tenant business state across requests (P0-C).

## Migrations — forward-only
- `platform/supabase/migrations/*` are additive, timestamp-ordered. The latest
  (`20261003000000_phase0_write_safety.sql`) is `add column if not exists` + backfill + index +
  CHECK-widen; no destructive step.
- `make migrate` (`supabase migration up --local`) is the sanctioned non-local apply path. Production
  deploys run migration-up / `db push`, **never** `db reset`. The destructive `db reset --local` is
  now explicitly marked LOCAL ONLY in the Makefile and is not reachable from any deploy script.
- Root CI applies migrations forward-only against a fresh Postgres before the DB-gated suites.

## Deferred
Model-usage and outcome persistence (Phase 1, see P0-F); a formal cross-DB reconciliation job (not
needed while the engine holds no business authority).
