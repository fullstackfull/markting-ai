# 14 — Master Development Roadmap

**Status: PROPOSED. Not authorized by this mission.** This mission is assessment only; the user said
explicitly "DO NOT BUILD NEW FEATURES YET … Do NOT begin implementation." This roadmap exists so that
when a build is authorized, there is an evidence-grounded order. It is grouped into **programs**, not
continued phase numbers (the old Phase 1–7 numbering is retired — those phases built depth; these
programs build *reachability and value*).

The governing insight: **the hard parts are largely done.** Safety, tenancy, connectors, and a deep
(if naive-in-places) deterministic analytics brain already exist and are tested. What is missing is the
**middle** — orchestration and product surfaces — plus correctness fixes to the math before it is
surfaced. So the roadmap is ordered by *leverage*, not by building more depth.

---

## Program 0 — Safety patch (must ship first, tiny, independent)

The one discrete defect that should not wait for a product decision.

- **Fix P0-5:** forward-only migration adding the standard RLS block (enable RLS + restrictive
  `authenticated using(false)` deny + `adport_backend` policy + `revoke from anon, authenticated`) to
  `markting_ai_usage` and `markting_business_context`. Add a DB-lane test asserting cross-tenant denial
  for both, mirroring the existing isolation tests.
- **Add P2-1:** an SCA/SAST lane to CI (dependency audit + a code scanner).

*Leverage: closes the only live security hole; ~1 migration + 1 test + 1 CI lane.*

## Program 1 — The Orchestrator (the missing middle — highest leverage)

A single cross-domain reasoning path that composes the existing engines, because nothing does today
(P0-3). This is the keystone: it unlocks diagnostics, allocation, creative, and commerce at once.

- Build one orchestration entry (`analyze` → compose) that fuses media diagnostics + commerce profit/MER
  + creative signals + experiment/outcome history + memory into a single structured result.
- Unify the four parallel recommendation pipelines (P1-9) behind one adapter to the canonical
  `Recommendation` type.
- Feed outcomes/memory into `generateRecommendations` to close the learning loop (P1-7).
- Keep it deterministic-first; the model (if/when wired) narrates only.

## Program 2 — Decision & Attention surfaces (make the brain reachable)

Net-new pages + the design-system primitives they require (P3-5: charts, recommendation cards, an
attention/brief surface). Wire the dormant engines to these surfaces and to MCP tools.

- **Attention/Overview v2:** triage — what needs attention in 30 seconds (anomalies, pacing, findings).
- **Opportunity/Allocation surface:** "where should the next \$1,000 go" (response-curve + allocation).
- **Recommendation queue:** accept/apply cards flowing into the existing approval/governance rail.
- **Performance drill-down:** date ranges, trends, breakdowns, ad-level.
- Run the 4-rule audit from the dashboard (P2-10) and expand the rule set.

## Program 3 — The AI decision (resolve the "AI" story)

Decide and execute one of:
- (a) Wire a **real governed model** through the gateway (add multi-provider routing + fallback, P1-8),
  and build a **real model-eval harness** in CI (prompts → model → scored rubric, P2-2); or
- (b) Reposition the assistant explicitly as a **deterministic-analytics narrator** and stop calling the
  scripted path "AI."

Either way, replace the scripted demo engine as the production brain (P0-2).

## Program 4 — Commerce & Creative value props (surface + correctness)

- Store/commerce connection UI + MER/profit/reconciliation surfaces (P1-1).
- Creative library/fatigue/cluster surfaces (P1-2).
- **Before surfacing, fix the math** that these depend on: discount-convention provenance (P1-16),
  same-window CAC/MER cohorting (P1-15), reconciliation thresholds scaled by n (P1-14).

## Program 5 — Agency portfolio

Client/brand tier above accounts, cross-client roll-up, "which client needs attention" triage, and a
reachable FX-aggregation path (P1-4). Delivers the `clientWorkspaces` the billing page already sells.

## Program 6 — Statistical-method hardening (do with/just before each engine is surfaced)

Fix the mis-specified methods so surfaced numbers aren't confidently wrong: sample-size units (P1-12),
rolling+date-anchored anomaly baseline (P1-13), forecast variance under autocorrelation (P2-6),
response-curve stability (P2-7), pacing min-elapsed + real timezone handling (P2-8), value-weighted
confidence floors (P2-9).

## Program 7 — Scale-readiness (gate each surface on it)

Replace `effectivenessRows` with SQL aggregation / materialized rollup + caching (P0-8), batch commerce
ingestion in transactions (P1-17), add pagination + "incomplete" signaling and windowed aggregation
(P1-18), add the missing indexes and per-org queue fairness (P2-4/5).

## Program 8 — Test & release confidence

Real provider contract/replay tests (P0-6), browser/E2E of the core journey + CI-collected agent eval
(P0-7), systematic RLS regression coverage (P1-19), migration rollback tests (P2-14), interactive UI
tests (P2-3).

---

## Recommended order and why

1. **Program 0** (safety patch) — independent, tiny, no reason to wait.
2. **Program 1** (orchestrator) — the keystone; everything reachable depends on it.
3. **Program 2** (decision/attention surfaces) — turns the orchestrator into buyer value; moves the
   8/50 benchmark number.
4. **Program 3** (AI decision) — in parallel with 2; resolves the credibility gap.
5. **Programs 4–5** (commerce/creative, agency) — the remaining value props, each gated on its math
   (Program 6 slice) and scale (Program 7 slice).
6. **Programs 6–8** run *as slices alongside* the surface that needs them, not as separate late phases —
   math/scale/test fixes ship with the surface that exposes them.

**Sequencing rule:** no engine is surfaced to users until its Program-6 math slice, its Program-7 scale
slice, and its Program-8 test slice are done for that engine. Reachability without correctness just
surfaces confidently-wrong numbers.

## What NOT to build

- **No new siloed depth** (a "Phase 8" of another detached engine) — marginal value ≈ 0 until the
  existing engines are reachable.
- **No autonomous optimization / provider writes** — remains DISABLED; Mode B stays HELD. The governed
  chain (recommendation → preview → human approval → apply-time revalidation → atomic claim → provider
  write → audit → reconciliation) is the only write path, unchanged.
- **No fabricated live validation** — live provider/model/commerce remain `BLOCKED_EXTERNAL` until the
  operator provisions real credentials via the deploy runbook.
