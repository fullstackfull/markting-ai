# C.5 (14) — Final pre-live security review

Independent adversarial review of the NEW Phase C.5 operational surfaces (worker, webhooks, alerts,
incidents, observability, health, live tooling), reading the actual code. **No P0/P1 found.** Three P3
hardening items were fixed in code; the rest are accepted notes. No live credentials were introduced.

| # | Area | Verdict | Basis |
|---|------|---------|-------|
| 1 | Worker tenant context | PASS | Job org/provider come only from the trusted queue row; `guardJob` blocks kill-switch / unsupported-provider / disallowed-source / disabled-connection before `execute`; CANCELLED/SUCCEEDED/DEAD_LETTER never loaded; `UNKNOWN` never blind-replayed (routed through backoff/dead-letter). |
| 2 | Webhook tenant resolution | PASS | Org is only `conn.organizationId` (never the payload); HMAC verified before any side effect; 1MB cap, ±5min replay window, dedup, per-provider event allowlist, disabled-connection gate, dead-letter; opaque responses. |
| 3 | Account authorization | PASS | Unchanged C0.1 single guard; cross-tenant and unknown both → `notFound()` (no oracle). |
| 4 | Admin incident operations | PASS | All 4 actions `requirePlatformMutator` (excludes READ_ONLY_AUDITOR) + `assertReason` + `recordPlatformAdminAudit`; page + actions independently gated (a direct tenant POST is still blocked). |
| 5 | Alerts/incidents RLS | PASS | RLS on all 3 tables; policies/grants only for `adport_backend` + `adport_platform_admin`; no authenticated/member policy → tenant default-deny (proven on real Postgres). |
| 6 | Observability redaction | PASS | Health output is only `{state, reason}` — no connection string/hostname/version/stack; DB probe failure → UNAVAILABLE (no trace); ConsoleLogExporter routes through `redactLog`. |
| 7 | Live-verify / capture / sanitizer | PASS | Both scripts off-by-default (enable flag + provider + creds), read-only, zero network, credentials never printed; sanitizer redacts tokens/emails/PII/customer-ids by key denylist + value heuristic, shape-preserving, idempotent. |

## P0 / P1

**None.**

## P3 hardening — FIXED in code

- **Webhook body read before size cap** → added a `Content-Length` pre-check (and a post-read length
  check) in `app/api/webhooks/[provider]/route.ts`, returning `413` before/without buffering an
  oversized body (memory-DoS hardening on the public endpoint).
- **Connection-existence oracle via HTTP status** → collapsed the pre-authentication denials
  (`UNKNOWN_CONNECTION`, `NOT_CONFIGURED`, `INVALID_SIGNATURE`, `DISABLED_CONNECTION`) to a single
  `401` in `webhook-ingress.ts`, so the status never reveals whether the addressed connection exists.
- **`lease_owner` attribution on save** → `sync-store.ts` `save()` now clears `lease_owner` (a saved
  job is no longer leased; the atomic `claim` is the sole writer of a live lease owner).

## P3 — accepted (non-blocking) notes

- **Stripe dedup not persisted across requests** — Stripe is verified but not enqueued (not a commerce
  provider), so cross-request replay dedup would need its own events table; no downstream effect today
  (no sync is fired). Recorded for when a non-commerce webhook needs durable replay dedup.
- **Prometheus exporter does not route through `redactLog`** — safe by the implicit contract that metric
  labels are typed/structural (metric names are a closed union; callers set org-id/structural labels
  only). Keep secrets out of labels by construction.

## Live-dependent items (BLOCKED_EXTERNAL — reviewed, not credential-tested)

Live OAuth callback/token exchange + refresh/replay, live provider reads/writes, the live webhook secret
derivation (one KMS-sealed spot), and a real OTLP/metrics backend export remain BLOCKED_EXTERNAL per the
C0.5 review — reviewed statically, never fabricated.

**Conclusion:** no open code-solvable P0/P1; the three P3s are fixed; Mode B HELD; autonomous
optimization OFF. The new operational surfaces are safe to carry into first credentialed verification.
