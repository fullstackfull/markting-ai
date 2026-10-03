# 07 — Secrets / KMS (7K)

`ops/kms.ts`. Rotation-safe ENVELOPE encryption: each secret is sealed with a per-record data key,
which is wrapped by a VERSIONED master key. New writes use the single ACTIVE master key; PREVIOUS
versions are retained for DECRYPT, so rotation needs NO downtime and existing provider tokens stay
readable.

- `seal` / `open`: AES-256-GCM envelope; `open` selects the master-key version that sealed the record.
- `KeyRing.rotate`: adds a new ACTIVE key, demotes the former ACTIVE to PREVIOUS (still decrypts old
  data); the ring enforces exactly one ACTIVE key.
- `reseal`: background re-encryption under the ACTIVE key.
- No plaintext secret is persisted or logged; `secretFingerprint` gives an audit token without the
  secret.

`markting_encryption_keys` stores key-version METADATA (version, state, timestamps) — never the raw key
material, which in production is held by a cloud KMS. A real cloud KMS is BLOCKED_EXTERNAL in this
environment; the envelope design is correct and rotation-proven in tests (data sealed under v1 still
decrypts after rotating to v2).
