# 06 — Webhooks & Sync

## Webhooks
- **Stripe billing** — READY: `/api/billing/webhook` verifies via `constructEvent`, idempotent via
  `private.billing_events`, handles subscription + `invoice.payment_failed/payment_action_required`.
- **Commerce** — verifier READY, route NOT mounted: `ingestWebhook` does HMAC-SHA256 verify + 5-min replay
  window + dedup + server-derived tenant (never from payload), backed by `markting_commerce_events`. No HTTP
  route calls it yet → BLOCKED_EXTERNAL. Signing secrets are stored as an **opaque ref** (`signing_secret_ref`),
  never the secret; fail-closed when absent.
- **Ad providers** — no webhook support (none register/ingest webhooks). The registry marks `webhook:false`,
  so the UI never offers webhook controls for them.
- Secrets are never exposed; the canonical model surfaces only `last_webhook_at`.

## Sync
- Paid-media reads are **on-demand** (`report()`/`listAccounts()`), plus a one-time account-inventory snapshot
  at connect. There is **no background entity/metric sync job**.
- The commerce incremental-sync engine exists (cursor/high-water checkpoints, idempotent upsert, dead-letter,
  bounded page count) but has **no scheduled caller**.
- The only background execution in-repo is 3 DB-hygiene pg_cron jobs (data retention, account-selection expiry,
  MCP token purge). No sync/observation runner is wired.
- Therefore `retrySync` (tenant and admin) is honest: it records intent + a `sync_triggered` event and returns
  **BLOCKED_EXTERNAL** ("no runner deployed"). `last_sync_at`/`next scheduled run` are shown only where real.

## To wire sync/webhooks live (out of scope here)
Mount a commerce webhook route; deploy a worker (or Vercel Cron) that claims due jobs
(`claimDueJobs`/`runIncrementalSync`) and advances `markting_commerce_sync_state`. Until then the control plane
reports these capabilities as BLOCKED_EXTERNAL rather than faking freshness.
