# 06 — Provider & Commerce Health / Observability (Discovery)

**Headline:** all 11 ad providers and 5 commerce connectors are implemented and **strictly tenant-scoped with RLS**.
There is **no platform/fleet operator view** of connection health, token expiry, revocations, rate-limits, sync
failures, outages, connected-org counts, failing stores, or webhook failures.

## Providers (ad platforms)
- **Implemented (all 11):** packages `platform/packages/{meta,google,tiktok,snapchat,microsoft,apple,reddit,pinterest,
  linkedin,x,spotify}`; canonical list `CLOUD_PROVIDERS` (`lib/cloud/types.ts:87`); OAuth adapters
  `provider-oauth.ts:62-380`, `provider-oauth-extra.ts:31-64`, `provider-oauth-x.ts:16-34`.
- **Storage:** `public.connections` (metadata; unique `(org,provider)`; `20260817171039...:53-68`) + secrets in
  `private.provider_credentials` (encrypted ciphertext + key_version `:73-83`); provider set widened to 11 by
  `20260831010651_provider_expansion.sql:3-17`. Tokens never sent to browser (`provider-oauth.ts:18-23`).
  Encryption AAD-bound `connection:{org}:{provider}` (`credential-rotation.ts:22,31,37`).
- **Expiry/refresh/revocation:** refresh is **lazy** at runtime construction via `onRefreshToken` callbacks
  (`runtime.ts:75-144`), concurrency-safe with fail-closed grant-match (`credential-rotation.ts:23-42`). **No
  scheduled/proactive expiry sweep** — `expiresAt`/`refreshExpiresAt` are stored but never queried to pre-empt expiry.
  Revocation via `DELETE /api/connections/[provider]` (owner/admin `:28`), provider-revoke-then-delete; several
  providers can't programmatically revoke and return `false` (manual) — `provider-oauth.ts:259,316`, `-extra.ts:38-62`.
- **Health model is thin:** DB `connection_status` enum is only `('connected','error','revoked')`
  (`...cloud_initial_schema.sql:14`); all failures collapse to `error` + free-text `last_error` (`repository.ts:246-250`).
  `provider-errors.ts` is a display-string sanitizer, not a persisted state model; **no rate-limit / outage /
  schema-drift / last-sync classification exists**. `account-status.ts:6-21` only maps a provider ad-account status to
  a UI label. Surfaced only on the tenant Connections page (`app/dashboard/connections/page.tsx:17,34-42`), refreshed
  opportunistically on OAuth callback (`callback/route.ts:98-121`).
- **`provider-rollout.ts`** — a deploy-time env allowlist, not an operator console: gated set
  `{snapchat,spotify,pinterest,linkedin,x}` (`:6`) + env `ADPORT_PROVIDER_TEST_ORGANIZATION_IDS` (`:12-15`); unset ⇒
  open to all; synthetic-reviewer orgs always denied (`:10`). Per-org (by id list), controlled by whoever sets the env
  secret. See `10`.
- **Platform cross-tenant visibility → MISSING.** No route aggregates `connections` across orgs; every read filters by
  org; RLS `connections_select_member` blocks cross-tenant browser reads (`:291-294`). No count-by-provider,
  healthy/expired/revoked, rate-limit, outage, or error-rate rollup; no provider-outage/incident table.

## Commerce (Salla, Zid, Shopify, WooCommerce, generic)
- **Implemented (all 5):** unified read-only `CommerceConnector` (`lib/markting/commerce/connector.ts:44-57`); classes
  in `providers.ts` (`SallaConnector:112`, `ZidConnector:152`, `ShopifyConnector:184`, `WooConnector:233`,
  `GenericConnector:269`); capability matrix incl. COGS/webhooks (COGS only true for Shopify `connector.ts:64-70`).
- **Storage (tenant-scoped, RLS + revoke):** `20261009000000_phase5_commerce.sql` — `markting_store_connections`
  (platform/status, opaque credential/signing refs `:7-21`), `markting_orders` (`:24-55`), `markting_order_lines`
  (`cogs_minor` nullable — "UNKNOWN stays null, never 0" `:69`), `markting_refunds`, `markting_products`,
  `markting_product_costs` (insert-only), `markting_commerce_sync_state` (cursor/high_water/status/consecutive_errors
  `:118-128`), `markting_commerce_events` (webhook/dead-letter dedup `:130-139`). RLS deny + backend-only + revoke
  (`:164-180`). Org asserted before every write (`store.ts:10-12`).
- **Webhooks:** HMAC-SHA256 timing-safe verify, 5-min replay window, dedup, org **derived from the connection, never
  the payload** (`commerce/webhooks.ts:38-64`); fail-closed on missing signing secret (`store.ts:149-175`).
- **Data quality (per-batch, tenant-scoped, not persisted as fleet telemetry):** `data-quality.ts:9-75`
  (DUPLICATE_ORDER, MISSING_CURRENCY, NEGATIVE_TOTAL, REFUND_EXCEEDS_ORDER, UNKNOWN_PRODUCT, SYNC_GAP, …);
  `diagnostics.ts:17-20,86-90` (COGS-availability gaps; review-only, `requiresHumanApproval:true`). Surfaced on tenant
  Data-Quality (`app/dashboard/data-quality/page.tsx`) and Commerce (`app/dashboard/commerce/page.tsx`) pages.
- **Platform cross-store visibility → MISSING.** No cross-tenant query over store connections / sync-state / events;
  no operator view of connected-store counts, failing/stuck-sync stores, webhook-failure/signature-rejection rates,
  sync-lag distribution, or dead-letter backlog (dead-letters stored per-org, never rolled up).

## Summary (tenant exists vs platform missing)
| Signal | Tenant (exists) | Platform operator (missing) |
|---|---|---|
| Connection status | 3-state + last_error on Connections page | fleet health rollup |
| Token expiry/refresh | stored + lazy refresh | expiry forecast / mass-refresh-failure view / proactive sweep |
| Revoked tokens | per-connection delete + `revoked_at` | revoked-token fleet view |
| Rate-limit / outage / schema-drift | **not modeled** | entirely missing |
| Provider error summary | display string only | error-rate aggregation |
| Commerce stores/sync | full per-tenant tables + DQ page | fleet store/sync-lag/failing-store view |
| Webhook health | per-event verify/dedup/dead-letter | webhook-failure-rate rollup |
| Data quality / COGS | per-batch typed checks | cross-tenant DQ / COGS-coverage metrics |

## Implications
Operator Provider-health and Commerce-health consoles are **greenfield read-models**. Because the rich signals already
exist per-tenant (connection status, sync_state, commerce_events, DQ findings), the main work is **cross-tenant
aggregation read-models** (built carefully as the first legitimate `adport_backend` cross-org queries) plus **new
state** the system doesn't track: a richer connection-health enum (expired/rate-limited/degraded), a proactive
token-expiry sweep, and persisted webhook/sync failure counters for alerting. See `13` GAP-PRV-*/GAP-COM-*, `14`.
