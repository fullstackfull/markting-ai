# 10 — Security Red Team 7.0

An independent security / SRE / distributed-systems panel ran the full Security Red Team 7.0 attack
list read-only. Key framing: the Phase-7 ops layer is governance PRIMITIVES (pure functions + a
tenant-scoped store) — there is **no apply/provider-write endpoint wired yet**, so no live bypass
exists today (attacks 23/24/25 — model approve / model write / prompt-injection-to-execute — hold
trivially: the model is hard-denied and there is no execution surface to reach). The value of the
review was hardening the primitives so they stay safe the moment an apply path is wired.

## Verdict

Core invariants HOLD: self/model/service-account/no-perm approval hard-denied; duplicate-actor and
cross-tenant approval blocked; atomic claim is a true single-winner conditional UPDATE; kill switch is
DB-backed, cluster-safe, and fail-CLOSED; append-only tables (approvals, change records) have no
update/delete grant; RLS on all 8 tables; KMS rotation keeps old data decryptable. Six hardening gaps
were found and fixed with regressions.

## Findings and dispositions

| # | Finding | Rank | Disposition |
|---|---------|------|-------------|
| F1 | `revalidateAtApply` failed OPEN on missing live data (a partial live probe skipped the budget/currency/status checks → a stale approval could apply over a changed world) | **P1** | **FIXED** — required live-state checks now fail CLOSED (missing value → REPREVIEW_REQUIRED); the action's `requiredLiveStateChecks` are passed in. |
| F3 | `transitionOperation` was read-modify-write with no CAS → concurrent transitions (apply vs expire) could last-writer-win | **P1** | **FIXED** — every transition is now a compare-and-swap (`where ... and state = <observed>`), throwing `ConcurrentTransitionError` when it loses the race. |
| F5 | budget delta cap (±50%) was evadable by omitting `fromMinor`, which was also absent from the operation digest | **P2** | **FIXED** — `SET_DAILY_BUDGET` now REQUIRES the server-observed `fromMinor` (rejected if absent) and binds it into the operation digest. |
| F6 | `UNKNOWN_RESULT → APPLIED` was a legal transition with no evidence binding | **P2** | **FIXED** — that transition now requires a reconciliation verdict of `APPLIED_CONFIRMED`, else it throws. |
| F6b | `recordApproval` performed no SoD check (relied on the caller) and snapshotted roles | **P3** | **FIXED** — SoD (`canApprove`) now runs at write time too (self/model/service-account rejected); docs note quorum must re-derive current roles at apply. |
| F4 | `resolveClientScope` validated only agency + client-org, not that a requested workspace/account belongs under that client | **P3** | **FIXED** — when the server scope graph is provided, workspace/account membership under the client is enforced. |
| F2 | `markting_kill_switches` `unique(scope, scope_key)` could let one tenant's ACCOUNT switch collide with/overwrite another's | **P3** | **FIXED** — ACCOUNT switch keys are now ORG-QUALIFIED (`org:account`), so they never collide across tenants; platform scopes stay org-null. |

## Invariants verified as HOLDING (not assumed)

- **No live bypass:** no code mutates a provider; the model is capped to `use_ai`/`create_recommendation`
  and can never approve or execute.
- **Atomic claim:** conditional single-row UPDATE; the DB test proves exactly one of two concurrent
  claims wins.
- **Kill switch:** DB-backed (cluster-safe, not filesystem), fail-CLOSED on a read error, correct org
  isolation on reads.
- **Append-only integrity:** approvals + change records have only `select, insert`; the Phase-0 blanket
  update/delete grant predates these tables (migration ordering verified) and does not reach them.
- **SoD:** self / model / service-account / no-permission approvals hard-denied; duplicate-actor and
  requester exclusion in quorum; senior-approver escalation correct.
- **KMS rotation:** data sealed under v1 still decrypts after rotating to v2; a sealed secret opens only
  with its key version; exactly-one-active enforced.
- **State machine:** illegal jumps (PENDING_APPROVAL→APPLIED, APPLIED→APPLYING) refused server-side.

## Load / chaos posture

Concurrent approvals (PK + dedup), concurrent claims (CAS single-winner), concurrent transitions (CAS,
F3), worker restart mid-apply (CLAIMED/APPLYING persisted; UNKNOWN_RESULT reachable; no auto-APPLIED),
provider timeout (UNKNOWN_RESULT + reconciliation), and rate limiting (health → RATE_LIMITED blocks new
writes) are all modeled deterministically and exercised in the eval + DB suites. External provider
production is never attacked; controlled adapters/fixtures are used.

The panel's report is model output treated as findings to verify, not authority; each fix was validated
against the suite (`test/phase7-redteam-fixes.test.ts` + DB-gated CAS / evidence-gate / SoD cases).
