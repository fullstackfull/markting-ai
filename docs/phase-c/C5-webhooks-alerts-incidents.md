# C.5 (3,4,5) — Webhook ingress · alert delivery · incident operations

## Webhook ingress (C.5-3)

`app/api/webhooks/[provider]/route.ts` + `lib/markting/commerce/webhook-{adapters,ingress}.ts` mount the
previously-missing webhook routes for **shopify / woocommerce / salla / zid / stripe**.

Security pipeline (order matters), reusing the existing pure HMAC verifier (`commerce/webhooks.ts`):
known provider → **1 MB body cap** → per-provider signature/body extraction + **event-type allowlist** →
resolve connection → **signature verify (HMAC-SHA256, timing-safe)** → **replay window** (±5 min) →
**active-connection gate** → **dedup** → enqueue a `WEBHOOK_TRIGGERED` sync (commerce only) → **audit**;
an enqueue/processing failure → **dead-letter**. Responses are opaque (`{ok}`/`{error}` + status), leaking
no internal detail.

**Tenant is always connection-derived, never from the payload** — a forged org/store id in the body
cannot cross tenants (proven by the "wrong-tenant payload cannot override resolved org" test). Live
webhook secrets are **BLOCKED_EXTERNAL**: `createPostgresResolveConnection` returns `signingSecret: null`
and the route answers `503 NOT_CONFIGURED` rather than fabricating a secret; the one derivation spot
(KMS-sealed webhook secret) is marked for when secrets exist. 14 offline security tests.

## Alert delivery (C.5-4)

`lib/markting/ops/alerts.ts` + `alert-delivery.ts` + `alert-store.ts` — ONE canonical pipeline (not one
per subsystem). 11 alert types (PROVIDER_OUTAGE, AUTH_FAILURE_SPIKE, REAUTH_SPIKE, SCHEMA_DRIFT,
SYNC_BACKLOG, STALE_DATA, WEBHOOK_FAILURE, AI_GATEWAY_FAILURE, AI_COST_ANOMALY, QUEUE_FAILURE,
SECURITY_INCIDENT). Each instance carries severity / source / org / provider / first_seen / last_seen /
count / state / correlation_id / evidence. **Anti-storm**: a repeat within cooldown bumps count + last_seen
without re-delivery; a repeat after cooldown (or after RESOLVED) reopens and re-delivers (fresh
correlation id on a post-resolve reopen). Delivery is the first-class internal **Platform Admin channel**;
external channels (email/Slack/pager) are optional adapters implementing the same `AlertChannel` port; a
failing channel never blocks persistence or siblings. Persisted in `public.markting_alerts` (upsert on
dedup_key).

## Incident operations (C.5-5)

`lib/markting/ops/incidents.ts` + `incident-store.ts` — a legal-transition state machine:
OPEN → ACKNOWLEDGED → INVESTIGATING → MITIGATED → RESOLVED, with POSTMORTEM_REQUIRED reachable; an
append-only timeline; reason required on every transition; a resolution note required to RESOLVE.
Alerts link to incidents (`markting_alerts.incident_id`).

`/admin/incidents` (`app/(admin)/admin/incidents/page.tsx`) — the operator console: summary widgets,
recent alerts, and per-incident inspect / acknowledge / assign / update-status / resolve. Every mutation
(`lib/platform/incident-actions.ts`) is **role-gated** (`requirePlatformMutator`, never READ_ONLY_AUDITOR),
**reason-required** (`assertReason`), and **audited** (`recordPlatformAdminAudit`).

## Isolation

`markting_sync_jobs`, `markting_alerts`, `markting_incidents` (migration `20261019000000`) have RLS
enabled, backend RW + platform-admin read, and **no authenticated/member policy** — a tenant can never
read platform operational data (proven on real Postgres: authenticated role sees 0 rows).

**Status:** all three implemented + tested (unit + real-Postgres). Live webhook secret derivation is the
only BLOCKED_EXTERNAL seam; alert external channels are optional adapters; incident workflow is complete.
