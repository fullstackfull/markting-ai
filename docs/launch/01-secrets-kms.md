# 01 — Secrets / KMS (Stage 2)

Implemented (`lib/markting/ops/kms.ts`): rotation-safe ENVELOPE encryption — per-record data key wrapped
by a VERSIONED master key; new writes use the single ACTIVE key; PREVIOUS versions decrypt old data; no
plaintext secret is persisted or logged; `secretFingerprint` gives an audit token without the secret.

## Rotation drill — PERFORMED (non-production)
`test/launch-pilot.test.ts` executes a real rotation drill:
1. seal a provider token under key v1; capture its audit fingerprint.
2. rotate to v2 (v1 → decrypt-only).
3. open the v1-sealed secret AFTER rotation → still readable (zero downtime).
4. reseal under v2 and re-open → readable; fingerprint stable.
5. a secret sealed under v1 is UNOPENABLE by a ring lacking v1 (fails closed).
Result: RUNTIME_PROVEN (non-prod software envelope).

## Production (cloud KMS) — BLOCKED_EXTERNAL
Cloud-KMS-backed master keys + the production rotation flow require real KMS credentials, absent here.
`markting_encryption_keys` stores only key-version METADATA (never raw key material). No browser ever
receives a model/provider key; secrets are redacted from logs (`observability.redactLog`).
