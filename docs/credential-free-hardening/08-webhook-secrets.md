# 08 — Webhook secret derivation + key management (items 13, 14)

`lib/markting/ops/webhook-secret-provider.ts`, `lib/markting/ops/key-management.ts`,
tests (17 total).

## Webhook secret derivation (item 13)

A `WebhookSecretProvider` port isolates *where* a per-connection webhook signing secret comes from:

- `LocalTestWebhookSecretProvider` — deterministic derivation for tests/dev (no real secret).
- `EnvWebhookSecretProvider` — reads from process env / secret storage at the edge.
- `KmsWebhookSecretProvider` — derives per-connection secrets from a KMS-held root key.

Secrets are derived per `(organizationId, connectionId, provider)` so one leaked secret cannot verify
another connection's webhooks. No secret is logged or returned in any envelope.

## Key management (item 14)

`KeyManager` abstracts encrypt / decrypt / rotate / version / revoke over the existing `kms.ts`
AES-256-GCM keyring. Keys are versioned so rotation is non-destructive (old ciphertext still decrypts under
its version until re-encrypted); `revoke` marks a version unusable for new encryption. A
`ProductionKmsKeyManager` is a **BLOCKED_EXTERNAL** stub — it implements the interface but ships no cloud
KMS client; wiring a real cloud KMS is a deployment step. Tests run entirely against the local keyring.
