# 11 — DSAR/retention + PII classification + feature-flag safety + admin secret-safety (items 25, 26, 27, 28)

Files: `lib/markting/ops/dsar-workflow.ts`, `lib/markting/ops/pii-classification.ts`,
`lib/markting/ops/feature-flag-safety.ts`, `test/admin-secret-safety.test.ts`, +
`test/dsar-workflow.test.ts`, `test/pii-classification.test.ts`, `test/feature-flag-safety.test.ts`.

## DSAR / retention workflow (item 25)

`planDsar(subject, policy)` produces a deterministic, **reviewable** `DsarPlan` — one entry per
`DataClass` with an action (`EXPORT` / `ERASE` / `RETAIN_IMMUTABLE` / `PSEUDONYMIZE`) and a reason, derived
from `RETENTION_POLICY`:

- `immutable` audit/compliance classes (`audit_events`, `decision_events`) → `RETAIN_IMMUTABLE`, **never
  erased**.
- `userCorrectable` business memory → `ERASE` / `PSEUDONYMIZE`.

The plan **performs no deletion**. Execution is a separate, gated step over an injected store port
(in-memory fake in tests) and re-asserts the hard invariant at execution time: an `ERASE`/`PSEUDONYMIZE`
requested on an immutable class **throws** (`DSAR invariant violated`) regardless of plan content. A
retention-sweep planner likewise only plans which rows are past `defaultDays`.

## PII classification (item 26)

A pure classifier over arbitrary field maps → `NONE | LOW | DIRECT_IDENTIFIER | SENSITIVE | PAYMENT`, using
name heuristics (reusing `FORBIDDEN_PII_FIELDS`) plus value regexes (email / phone / card / IP). It
produces a redaction/pseudonymization plan and a guard asserting no `DIRECT_IDENTIFIER`/`SENSITIVE`/
`PAYMENT` field reaches a model-bound projection. Deterministic.

## Feature-flag production safety (item 28)

A typed flag registry with explicit production defaults (risky flags default-OFF), an environment guard,
a kill-flag, and an audit record `{flag, from, to, actor, reason, at}` per change. `HARD_PINNED_CATEGORIES`
= `live_write`, `autonomous_optimization`, `live_model` — these **cannot be enabled through this module**
(a compile-time `EnableableFlagKey` type excludes them *and* a runtime guard rejects them), directly
honoring **Mode B HELD** and **autonomous optimization DISABLED**.

## Admin secret-safety (item 27)

`test/admin-secret-safety.test.ts` pins the invariant against the **real** admin/connection read source
(`connections/platform-read.ts`, `connections/read.ts`, `platform/reads.ts`, `platform/ops-reads.ts`,
`platform/incident-reads.ts`): no admin surface selects a raw secret column (only `*_ref` pointers are
allowed), none reaches into the `private.*` schema where OAuth tokens/signing secrets live, fleet reads run
through the SELECT-only `adport_platform_admin` role (`platformDb`), and `redactLog` strips every
secret-looking field from an admin DTO at any depth while leaving metadata intact.
