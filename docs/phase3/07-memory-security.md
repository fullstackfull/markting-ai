# 07 — Memory & Outcome Security, Poisoning Defense, Retention (3S / 3T / 3U)

## Threat model & defenses (3S / 3T)

| Attack | Defense |
|---|---|
| Org A reads Org B memory/outcomes/timeline/decision events | Every store query is `where organization_id = …`; composite keys include the org; the DB suite asserts org A ≠ org B across all Phase-3 tables. |
| Org A guesses another tenant's recommendation IDs | Reads are org-scoped; a foreign id under the wrong org returns nothing (asserted). |
| Cross-tenant outcome jobs | Job rows are organization-tagged; a worker claims due jobs globally but performs each job's work with `job.organizationId` only — a job never touches another org's data. |
| Model tries to set `organization_id` | Org id is server-derived (`EngineContext`, never prose); the memory write schema REQUIRES `organizationId` and callers pass the authenticated principal's org — the model cannot inject one. |
| Prompt injection storing malicious memory | The LLM cannot write memory at all — writes go through `evaluateWritePolicy`; the source allowlist excludes free-text/ad content. |
| Malicious campaign name/ad copy becoming a long-term instruction | Provider/ad text is DATA; it is not an allowed memory source. `human_preference`/`explicit_fact` accept only human-confirmed (or verified-system) sources, so ad content can never be promoted to a preference or fact. |
| Memory poisoning via derived inference overriding a human rule | Trust ordering: a DERIVED memory may never overwrite an EXPLICIT human-configured value. High-impact preferences require explicit human confirmation. |

All external/provider text remains untrusted DATA throughout; structured context separates data from
system instructions (carried from Phase 2).

## Retention (3U) — `retention.ts`

Declarative retention per data class with explicit immutability:
- **Immutable audit evidence — never deleted by retention:** `audit_events`, `pending_operations`,
  `decision_events`.
- **Correctable business memory:** `marketing_memory` (inspect/correct/revoke per 3F), retained until
  revoked/expired.
- **Prunable with a default window:** chat threads (365d), recommendation history/outcomes (730d),
  model traces (180d), stored model prompts (30d, short to limit embedded-data exposure), reports
  (365d), usage ledger (730d), timeline events (730d).
`prunableClasses()` is the single source of truth a retention sweep reads; it excludes every immutable
class. No unlimited retention by accident; no deletion of compliance evidence.

## Independent expert red-team (3Z)

See the exit report for the panel's findings and the fixes applied. Confirmed-HELD invariants: the LLM
cannot write memory; provider/ad text cannot become trusted memory; derived cannot override explicit;
tenant isolation across all Phase-3 tables; outcomes never claim causation; rejected ≠ failed; memory/
playbook/learning cannot weaken a Phase-0 control or let the AI write to a provider.
