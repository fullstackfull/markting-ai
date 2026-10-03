# 02 — Connector Architecture (5B–5I)

## One contract (5B) — `connector.ts`

Every provider implements the SAME `CommerceConnector`: `capabilities`, `healthCheck`, `listStores`,
`listOrders` (windowed + cursor), `getOrder`, `listProducts`, `listRefunds`, optional `listInventory`
and `listProductCosts`. All methods are READ-ONLY and tenant-scoped (`connectionId` → server-derived
org). There is no per-provider domain model.

## Providers (5C–5G) — `providers.ts`

A `BaseConnector` holds the plumbing; each platform supplies normalizers. Connectors are driven by an
injectable `RawSource` — the exact seam a live HTTP client fills later — so the normalize path is fully
exercised against fixtures (FIXTURE_PROVEN) while live transport stays BLOCKED_EXTERNAL. No connector
issues a write. `healthCheck` reports the honest classification.

## Sync (5H) — `sync.ts`

`runIncrementalSync` resumes from a persisted `SyncCheckpoint` (cursor + high-water), paginates up to
`MAX_PAGES_PER_RUN` (bounded — never a full-history re-fetch), upserts orders **idempotently**, advances
the checkpoint, and on error **preserves the checkpoint** and writes a dead-letter (retry-safe, no data
loss). Backfill is an explicit bounded window (`backfillWindow`, max 400 days). The checkpoint store is
injected (`SyncStore`) and backed by `markting_commerce_sync_state` in production.

## Webhooks (5I) — `webhooks.ts`

Webhook payloads are UNTRUSTED. `ingestWebhook` resolves the connection to its **server-derived org +
signing secret**, verifies the HMAC signature (timing-safe, length-checked), enforces a replay window,
dedupes by persisted event identity, and records it. The payload's own `organization_id`/`store_id` is
**never** used to decide the tenant — only the connection mapping is. Order of checks: resolve → verify
→ replay → dedup → record.
