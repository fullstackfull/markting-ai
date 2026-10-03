# 02 — Marketing Memory (3E / 3F / 3G / 3T)

## Model (3E) — `memory.ts`, `markting_memory`

Typed, provenance-bearing, tenant-scoped business memory in five categories: `explicit_fact`,
`human_preference`, `historical_decision`, `historical_outcome`, `operational_context`. Every item
carries: organization_id, category, key, value, **source**, source_reference, trust, explicit flag,
confidence, created_at, last_verified_at, expires_at, revoked_at. No anonymous "the AI remembers…".

Trust levels (ordered): `EXPLICIT_HUMAN > SYSTEM_VERIFIED > DERIVED_HIGH_CONFIDENCE >
DERIVED_LOW_CONFIDENCE > STALE > REVOKED`. Trust is derived deterministically from source + explicitness
(`trustForSource`), never model-chosen.

## Write policy (3F / 3T) — `evaluateWritePolicy`, `memory-store.ts#writeMemory`

The LLM never writes memory directly. Every write passes a deterministic, schema-validated service:
- **Source allowlist per category.** Human preferences and explicit facts accept only
  `human_config / human_confirmation` (facts also accept `system_verification` / a verified
  `connected_source` API read). **Provider/ad free-text is not an allowed source for trusted memory**
  (poisoning defense, 3T) — advertising content can never become a preference or fact.
- **Trust ordering.** A DERIVED memory may never override an EXPLICIT human-configured value at the
  same key.
- **High-impact preferences** (`auto_approval_threshold`, `protected_accounts/campaigns`,
  `scaling_policy`, `risk_tolerance`, `budget_change_policy`, `approval_preferences`) require explicit
  human confirmation — never derived from a single behavior.

## Correction / forgetting (3F)

Memory is correctable business state, **distinct from immutable audit history**. Users can inspect
(`listMemory`), correct (`correctMemory`, human source only), and invalidate (`revokeMemory` →
soft-revoke, never a silent rewrite). `markStale` demotes trust past a verification horizon (explicit
human items are not auto-staled). Audit facts (audit_events, pending_operations, decision_events) are
never rewritten.

## Bounded retrieval (3G) — `memory-retrieval.ts`

The AI never receives the whole history. `retrieveMemory()` scores ACTIVE items (revoked/stale/expired
excluded) for relevance to the current account / provider / entity / recommendation category / recency
/ trust, and returns a token- and count-bounded selection with a `truncatedCount`.
