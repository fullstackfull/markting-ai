# Phase 3 — Exit Report

Branch `claude/amazing-heisenberg-0unnak`, from Phase 2 exit `48982b9` (Phase 1 `3e91494`, Phase 0
`e6fbd0c`). Phase 3 adds DECISION HISTORY → OUTCOME MEASUREMENT → MARKETING MEMORY → RECOMMENDATION
EFFECTIVENESS → LEARNING SIGNALS. The non-negotiable rule held throughout: memory/learning INFORM
recommendations and never bypass the policy engine, risk, approvals, budget limits, tenant boundaries,
human approval, or data-trust gates. Tags: CODE_COMPLETE / RUNTIME_PROVEN / BLOCKED_EXTERNAL.

## Invariant status

| Invariant | Status | Evidence |
|---|---|---|
| Trace recommendation → preview → approval → execution → outcome | RUNTIME_PROVEN (DB) | `decision-store.traceRecommendation`; `phase3-stores.database` |
| Outcome classified POSITIVE/NEGATIVE/NEUTRAL/INCONCLUSIVE/INSUFFICIENT_DATA/CONTAMINATED | RUNTIME_PROVEN (unit) | `outcomes.ts`; eval 1/4/5/6/17 |
| Correlation ≠ causation (code + narration) | RUNTIME_PROVEN (unit) | `OUTCOME_ALIGNED_WITH_RECOMMENDATION` / `TEMPORAL_ASSOCIATION`; `CAUSAL_EXPERIMENT_SUPPORTED` never set; eval 1/14 |
| Memory typed + provenance + trust ordering (derived ≠ override explicit) | RUNTIME_PROVEN (unit+DB) | `memory.ts`; eval 8/13; DB test |
| LLM cannot write memory; provider/ad text cannot become trusted memory | RUNTIME_PROVEN (unit) | deterministic `evaluateWritePolicy`; source allowlist + connected_source structural-key gate; eval 9/10 |
| Users can inspect / correct / forget memory; audit history immutable | RUNTIME_PROVEN (unit+DB) | `listMemory`/`correctMemory`/`revokeMemory`; `retention.ts` immutables; eval 7/18; DB test |
| Historical outcomes inform without weakening current evidence | RUNTIME_PROVEN (unit) | personalization phrasing-only (confidence/risk/status/evidence unchanged); eval 13 |
| Tenant A cannot access tenant B memory/history | RUNTIME_PROVEN (DB) | every store org-scoped; server-asserted org id; RLS + revoke added; `phase3-stores.database` |
| Confidence evaluated vs historical outcomes | RUNTIME_PROVEN (unit) | `calibrateConfidence` (INSUFFICIENT_HISTORY when under-sampled); eval 12 |
| AI explains what happened after previous recommendations | RUNTIME_PROVEN (unit) | `decision-aware-ask` labeled FACT/HISTORICAL/DERIVED/CURRENT; eval 11/19/20 |
| AI technically cannot bypass Phase-0 write controls | RUNTIME_PROVEN (unit) | registry read-only gate; no memory/playbook path to a provider write |
| Ready for real outcome learning | PARTIAL | machinery complete + DB-proven; needs live data + history to accumulate |
| Live provider read / live model narration | BLOCKED_EXTERNAL | no credentials; paths ready; no fabricated proof |

## Red-team (independent expert panel)

The panel confirmed the core invariants HOLD (no causation claims; no global accuracy score; rejected ≠
failed; LLM has no memory-write path; registry gate intact; immutable audit protected). It found **three
defense-in-depth PARTIALs**, all now **fixed**:

1. **Poisoning via `connected_source` facts** — a connected provider read could set a free-text explicit
   fact. Added a CODE content gate: `connected_source` may set only structural fact keys
   (`CONNECTED_SOURCE_FACT_KEYS`); free-text is rejected. (eval 10)
2. **Org trusted from payload** in the memory store — `writeMemory` now takes the server-derived org as
   its first argument, ignores/rejects any payload org, so a forwarded request body cannot write cross-
   tenant. (DB test: mismatched payload org rejected)
3. **Missing RLS** on the Phase-3 (and Phase-2) tables — added the house convention (enable RLS +
   restrictive `authenticated using(false)` + backend policy + `revoke from anon, authenticated`) for all
   nine tables, matching `markting_bridge`.

Minor also fixed: the outcome engine now gates the BEFORE baseline sample too (a thin baseline → INSUFFICIENT_DATA).

## Tests & CI

- Non-DB: `phase3-memory-outcomes` (19), `phase3-eval` (20), plus the full cloud suite — all green;
  typecheck clean. **DB-gated** `phase3-stores.database` (tenant isolation across all Phase-3 tables,
  lifecycle, dedup'd atomic job claim, org-mismatch rejection) runs in CI.
- CI (GitHub Actions, dispatched): migration `20261006000000` applies forward-only in the `cloud-db`
  lane; all six lanes green. Pre-fix green run id 37122913556; **final green run id recorded on the
  closing commit** (the RLS/memory-store changes re-validated in the DB lane).

## Performance

Memory retrieval is bounded (`DEFAULT_RETRIEVAL_BUDGET` 12 items / 4000 chars; `truncatedCount`
reported) so large histories never reach the LLM. Effectiveness/dashboard aggregations are O(n) folds
over ledger rows. Store queries are indexed (org+status/created_at, org+recommendation, due-jobs partial
index). The Phase-2 perf harness (10k campaigns ~141ms, bounded payload) is unchanged. A dedicated
1k-history / 10k-timeline / 100k-observation load test is noted as a follow-up; the retrieval bound and
indexes make unbounded LLM payloads structurally impossible.

## Provider parity carry-forward — assessed, DEFERRED (honest)

The Phase-2 staged reads (Meta/TikTok typed creatives, Meta budget/status normalization, TikTok ad-set)
were assessed against the provider packages. Implementing them means non-trivial changes to vendored-
style provider packages with their own regression suites, for value tangential to Phase 3's purpose;
the risk to the green provider suites outweighs the Phase-3 benefit. Per the mandate's "where reasonable"
and "do not claim full parity where generic passthrough is the only support", they remain **staged**
and the matrix in `docs/phase2/09-provider-read-matrix.md` is unchanged and not overstated.

## Exit questions

1. Trace rec→preview→approval→execution→outcome? **YES** (DB-proven). 2. Classify outcome incl.
inconclusive/contaminated? **YES**. 3. Distinguish correlation from causation? **YES** (no "caused"
path). 4. Remember explicit preferences safely? **YES** (typed, provenance, policy-gated). 5. Inspect/
correct memory? **YES**. 6. Historical informs without weakening current evidence? **YES** (phrasing-
only personalization). 7. Cross-tenant access? **NO** (org-scoped + server-asserted + RLS). 8. Ad text
poison memory? **NO** (source allowlist + content gate). 9. Confidence vs outcomes? **YES** (calibration,
honest about n). 10. Explain prior-recommendation aftermath? **YES** (labeled provenance). 11. AI unable
to bypass Phase-0 writes? **YES** (registry gate; no memory→write path). 12. Ready for real outcome
learning? **PARTIAL** — machinery ready; needs live data/history.

## Gate verdicts

- **Gate A — Real live reads: NOT READY (BLOCKED_EXTERNAL).** No credentials; path ready + proven on the typed boundary.
- **Gate B — Live AI narration: NOT READY (BLOCKED_EXTERNAL).** No model creds; governed local narration proven.
- **Gate C — Structured recommendations: READY (code).** Unchanged from Phase 2, still green.
- **Gate D — Recommendation outcome tracking: READY (code) / RUNTIME_PROVEN (persistence).** Lifecycle,
  linkage, before/after, classification, contamination, effectiveness — built and DB-proven; live
  outcome accumulation needs live data.
- **Gate E — Marketing Memory: READY (code) / RUNTIME_PROVEN (persistence).** Typed, provenance, trust
  ordering, poisoning defense, correction/forgetting, bounded retrieval — built and DB-proven.
- **Gate F — Human-approved controlled write pilot: HELD; NOT enabled.** Writes remain disabled; the
  only write path is the Phase-0 human-approved preview/apply; nothing here enables it automatically.
- **Gate G — First paying customer: NOT READY.** Live OAuth, live model, KMS/TLS/backups, operational
  hardening outstanding (carried from earlier phases).

## Phase-4 deferrals (not started, as mandated)

Autonomous budget changes; self-modifying policies; automatic pause; automatic experiment execution;
full multimodal creative AI; advanced causal inference engine; automatic cross-channel allocation; RL
controlling ad spend; unsupervised long-term memory writes; full commerce profit optimization; live
provider/model wiring; provider typed-read parity; large-scale load test.

## Everything still unproven

Live provider transport; live-model narration quality; production infra (KMS/TLS/backups/hosting);
provider parity beyond the Phase-2 matrix; commerce truth (connectors remain a typed contract); real
outcome-learning accuracy (needs accumulated live history). All DB-backed invariants are proven only via
the CI DB lane (no local Postgres in this sandbox).
