# Phase 3 — Baseline

Branch `claude/amazing-heisenberg-0unnak`. Phase 2 exit `48982b9` (Phase 1 `3e91494`, Phase 0 `e6fbd0c`).

Phase 3 adds, on top of Phase 2's `DATA → ANALYSIS → DIAGNOSIS → RECOMMENDATION`:

```
DECISION HISTORY → OUTCOME MEASUREMENT → MARKETING MEMORY → RECOMMENDATION EFFECTIVENESS → LEARNING SIGNALS
```

so the platform can answer: what did we recommend, did the user accept it, was it executed, what
happened afterward, was it beneficial / inconclusive, has a similar action worked here before, and
what has the organization explicitly confirmed.

## NON-NEGOTIABLE SAFETY RULE (held throughout)

Memory and learning **inform** recommendations; they never become authority to mutate an ad account.
They do not bypass the policy engine, risk classification, approval requirements, budget limits, tenant
boundaries, human approval, or data-trust gates. Order of authority: **system safety > organization
policy > AI suggestion**. Historical success is never a shortcut around any Phase-0 control. The AI
remains technically unable to write in read-only / recommendations mode (registry gate, Phase 1B), and
memory writes pass through a deterministic, schema-validated, tenant-scoped service — never the LLM.

## Environment reality (verified at baseline)

| Capability | State | Consequence |
|---|---|---|
| GitHub Actions runner | AVAILABLE (workflow_dispatch) | CI incl. the real-Postgres DB lane is run for real; Phase-3 tables get DB-isolation tests. |
| Live provider OAuth (Meta/Google/TikTok/Snapchat) | NOT PRESENT | 0.1 BLOCKED_EXTERNAL; read path kept ready; no live proof fabricated. |
| Live marketing model credentials (gateway allowlist) | NOT PRESENT | 0.2 BLOCKED_EXTERNAL; gateway keeps the free deterministic local narration; live narration recorded as blocked. (The session's own model access is not a product-gateway key and is not wired in.) |
| Local Supabase/Postgres | DOWN (Docker unavailable) | DB-gated suites run only in CI (`cloud-db` lane). |

Tags used throughout: **CODE_COMPLETE** (built + unit-proven against typed boundaries + synthetic),
**RUNTIME_PROVEN** (executed against a real runtime — here, the CI DB lane), **BLOCKED_EXTERNAL**.

## Built on (Phase 2, not rebuilt)

`intelligence/*` (diagnostics, recommendation, analyze, confidence/risk/impact, cross-channel, …),
`recommendation-store.ts` (lifecycle + events), `business-context.ts` (targets with provenance),
`ai-gateway.ts` + `usage-ledger.ts`, `commerce/contract.ts`, the Phase-0 policy engine + pending-ops
+ audit path. Phase 3 EXTENDS these — no redundant tables where an existing one serves.

## New persistent entities (one forward-only migration)

`markting_decision_events` (lifecycle + rec→pending-op linkage), `markting_recommendation_outcomes`
(before/after snapshots + classification + contamination), `markting_observation_jobs` (durable,
idempotent outcome scheduling), `markting_memory` (typed, provenance, trust), `markting_playbooks`
(tenant policy), `markting_experiments` (future-use model), `markting_timeline_events` (observed ops
context). All tenant-scoped, indexed, FK'd where appropriate, with DB-isolation tests.

## Workstream ledger (filled as built)

0.1 live read · 0.2 live narration · 3A lifecycle+linkage · 3B snapshots · 3C outcome engine ·
3D effectiveness ledger · 3E memory · 3F memory write policy · 3G retrieval · 3H decision-aware AI ·
3I playbook · 3J personalization · 3K learning signals · 3L calibration · 3M rejection reasons ·
3N modification tracking · 3O experiment model · 3P timeline · 3Q change-point context ·
3R observation jobs · 3S/3T security + poisoning defense · 3U retention · 3V/3W surfaces ·
3X brief-with-memory · 3Y eval 3.0 · 3Z red team · provider parity carry-forward.
