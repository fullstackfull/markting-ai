# 08 — Security & Privacy

## PII controls — `pii.ts`

Commerce data is sensitive (emails, phones, addresses, names, order notes, payment metadata).
`toAnalyticsSafe(order)` is the ONLY order shape that may reach an LLM: it reduces the customer to a
tenant-scoped pseudo-id + class/confidence, keeps money/stage/status/attribution-flags/sku refs, and
**drops** titles and all raw customer identity. `FORBIDDEN_PII_FIELDS` enumerates email/phone/name/
address/notes/payment/ip; `redactPii` recursively replaces them with `[REDACTED]` (defense-in-depth for
raw bags), and `containsPii` is a tripwire used in tests. **Order notes — a prompt-injection vector —
never enter model context.** `pseudonymize` is an HMAC keyed per-org, so ids are stable within a tenant
and differ across tenants (no cross-tenant identity, no reversible raw value).

## Multi-tenancy

- Tenant identity is **server-derived** (the connection's org), never taken from a payload or model.
- `store.ts` asserts `organizationId` and rejects a cross-tenant order write **before** any DB call.
- Webhooks resolve the org from the authenticated connection, not the payload's `organization_id`.
- All nine tables are org-keyed, FK'd to `organizations`, RLS-enabled (restrictive server-only policy +
  backend policy, anon/authenticated revoked) and indexed on the hot lookups.
- Sync cursors are stored per `(organization_id, connection_id)`; customer pseudo-ids are per-org HMACs
  (no cross-tenant collision as an identity claim).

## Secrets

Connections store an opaque `credentialRef` / `signingSecretRef` — never the secret itself. Webhook
signatures are verified with a timing-safe, length-checked HMAC comparison.

## Data quality fails closed

Corrupted business metrics (refund > order, negative totals, duplicates, future timestamps, impossible
quantities, mixed-currency lines, missing currency) are flagged and excluded from trusted aggregates
rather than silently distorting revenue/margin.
