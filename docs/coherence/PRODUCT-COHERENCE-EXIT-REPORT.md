# Product Coherence Program — Exit Report

**Honest summary.** This is a very large multi-program mandate (27 programs, 7 waves). This session
delivered the **coherence spine** — the security fix, the canonical models, the unified orchestrator,
the data-science corrections, and the first reachable product surfaces — all typechecked, unit-tested,
and CI-green (Waves 0–3; the final docs + golden-cases run is the last CI). It did **not** complete every
program: the remaining dedicated surfaces (account/campaign drill-down, standalone creative/commerce/
experiment/agency/executive pages), the IA/design-system/mobile/a11y programs, Playwright E2E, a
live-model eval harness, provider contract-replay tests, and the scale refactors are recorded as
PARTIAL / NOT_STARTED with plans. Nothing is fabricated; live provider/model/commerce remain
`BLOCKED_EXTERNAL`.

**Primary success criterion** (a buyer can log in → see what needs attention → understand why → inspect
evidence → get one coherent recommendation → design/save for later, without engineering knowledge): the
reachable path now exists end-to-end for the diagnosis→recommendation loop (Needs Attention + Assistant +
Recommendation Center, composed across media/commerce/creative), demonstrated on synthetic demo data.
The creative/commerce/experiment/agency *dedicated* steps are reachable within the composed diagnosis but
not yet as standalone surfaces.

**Benchmark:** 8/50 → **12/50 ANSWERABLE_NOW** (20 partial, 18 not). The 40/50 target was **not** reached;
see `14-benchmark-results.md` for the honest reason (remaining UI breadth + `BLOCKED_EXTERNAL` live data).

---

## The 40-item return

1. **Branch:** `claude/amazing-heisenberg-0unnak`.
2. **HEAD:** `167e810` at log time; final after docs commit (see repo).
3. **Commits:** `31099cd` (RLS migration+test), `0b79c35` (RLS test fix + orchestrator Wave 1),
   `6102580` (data-science Wave 2), `18b4d1d` (assistant service + surfaces Wave 3), `167e810` (golden
   cases), + this docs commit.
4. **Migrations:** `20261012000000_phase1_rls_fixup.sql` (forward-only, data-preserving).
5. **Security P0 result:** CLOSED and proven on real Postgres (CI run 24 green); cross-tenant denial +
   server-path-still-works regression test.
6. **Canonical models consolidated:** Money (→ `@adport/core` Money at the boundary, exponent-safe),
   trust (→ `DataTier`/`DataTrust` with adapters + weakest-capping), recommendation (→
   `UnifiedRecommendation` with lossless adapters from all four pipelines). Boundary DONE; physical
   dedup (Program 25) deferred.
7. **Orchestrator architecture:** `lib/markting/orchestrator/` — context → gather domain slices →
   `compose()` → one `IntelligenceResult` (composed diagnosis, ranked factors, single next action,
   unified recommendations, trust, availability). Deterministic; model narrates only.
8. **Formerly-siloed modules now connected:** media diagnostics, commerce diagnostics/profit, creative
   signals, and the four recommendation pipelines all compose through the orchestrator and surface in
   the Workspace/Recommendation Center (previously imported by zero app files).
9. **App routes added/changed:** `/dashboard/workspace` (new), `/dashboard/recommendations` (new), nav +
   i18n updated. (Account/creative/commerce/experiment/agency/executive routes: NOT_STARTED.)
10. **Assistant architecture:** `AssistantIntelligenceService` (question→intent router + gatherer →
    orchestrator → narrator) with honest `answerSource` (LIVE_MODEL/LOCAL_FALLBACK/DETERMINISTIC_ONLY).
    Live chat swap: PARTIAL (governed bridge preserved); live model: BLOCKED_EXTERNAL.
11. **Media Buyer Workspace:** DONE (Needs Attention surface); multi-lane layout + cross-account queue:
    PARTIAL.
12. **Recommendation Center:** DONE (one review queue, inspectable evidence, review-only); accept→save
    workflow: PARTIAL.
13. **Account/Campaign workflow:** PARTIAL (reachable via Workspace; dedicated drill-down NOT_STARTED).
14. **Creative workflow:** PARTIAL (composes into diagnosis/recs; dedicated creative surfaces NOT_STARTED).
15. **Commerce/profit workflow:** PARTIAL (composes; dedicated surfaces + store connector NOT_STARTED,
    store connection BLOCKED_EXTERNAL).
16. **Experiment/scenario workflow:** PARTIAL (OPTIMIZE recs compose; workbench NOT_STARTED).
17. **Agency workflow:** NOT_STARTED (least-served persona; orchestrator supports per-workspace, UI not
    built).
18. **Executive workflow:** NOT_STARTED.
19. **Arabic/RTL:** new surfaces bilingual via `BiText` + locale + logical CSS; full RTL audit of all new
    workflows: PARTIAL.
20. **Mobile:** new surfaces use the responsive shell; dense-table reflow program: NOT_STARTED.
21. **Accessibility:** semantic chips/headings on new surfaces; automated a11y CI: NOT_STARTED.
22. **Provider-depth improvements:** none this pass (NOT_STARTED); Google/Meta remain the deep providers.
23. **Data-science corrections:** DONE — sample-size units, pacing early-period guard, reconciliation
    sample-awareness, anomaly rolling baseline + anchored seasonality (12 tests). Remaining P2s:
    NOT_STARTED.
24. **Scale/performance corrections:** NOT_STARTED (gated to the live large-account gatherer; shipped
    surfaces don't run the heavy paths).
25. **Provider contract/replay tests:** NOT_STARTED (recorded as an outstanding P0; needs sanitized real
    payloads / live creds).
26. **Browser E2E:** NOT_STARTED (no Playwright harness; surfaces verified by `next build` + unit tests).
27. **AI evaluation harness:** PARTIAL — deterministic composition evals (orchestrator + 12 golden cases
    + assistant-service) exist as the scaffold; live-model-graded rubric: BLOCKED_EXTERNAL/NOT_STARTED.
28. **50-question benchmark before/after:** 8/50 → 12/50 ANSWERABLE_NOW (target 40/50 NOT reached; see
    doc 14).
29. **UI capability matrix before/after:** diagnostics, recommendations, creative, commerce, outcomes
    moved from BACKEND_ONLY to "reachable via the composed Workspace/Recommendation Center" (demo data);
    memory/experiments/agency/kill-switch/usage remain BACKEND_ONLY. (Full matrix refresh: PARTIAL.)
30. **Cross-domain scenario results:** 12 golden cases pass (of 20 named) — composition, ranking, next
    action, trust capping, honesty, review-only.
31. **Security findings:** 1 P0 CLOSED; no new attack surface from the new read-only surfaces; Program-24
    hardening slices outstanding.
32. **Independent panel findings:** three skeptical panels (AI-architect+principal-engineer; paid-media+
    agency-buyer; security+QA+data-scientist) reviewed the actual code. They VERIFIED: the orchestrator
    composition + reachability from Workspace/Recommendations, the Money/adapter correctness + fail-closed
    behaviour, the review-only safety guarantee, the RLS P0 fix (and its real-Postgres regression test),
    and all four data-science corrections as genuinely correct (not merely changed). They flagged three
    honest issues, now ADDRESSED: (a) benchmark #48 was inflated because the chat Assistant still routed
    only to the external engine — FIXED by wiring `runAssistantTurn` to fall back to the orchestrator
    (`askAssistantForPrincipal`) when the engine is unreachable; (b) the Recommendation Center lacked a
    demo/synthetic banner and showed synthetic commerce recs as "RECONCILED" — FIXED with a page-level
    "Demo / synthetic data" banner; (c) `money.ts` over-claimed in its docstring that "nothing leaves as
    a bare number" while the composition still passes some commerce figures as opaque evidence — docstring
    CORRECTED to state the integration is partial (Program 6/25). One clarification: the RLS regression
    test runs in the dedicated real-Postgres CI lane (ADPORT_RUN_DATABASE_TESTS=1, green run 24); it is
    skipped only in the non-DB node lane. The panels found no FALSE correctness claim and no material code
    defect in the shipped engines/surfaces.
33. **Tests passed/failed/skipped:** full non-DB cloud suite 733 passed / 82 skipped / 0 failed after
    Wave 3; +12 golden cases; data-science +12; orchestrator +10; assistant-service +6.
34. **DB tests:** RLS fixup regression test green on real Postgres (CI run 24); existing DB suites green.
35. **Performance benchmarks:** none run (scale program NOT_STARTED) — honestly outstanding.
36. **Remaining P0/P1/P2/P3:** P0 — provider contract tests, browser E2E (test-integrity P0s from the
    reassessment, still open). P1 — dedicated surfaces (account/creative/commerce/experiment/agency),
    learning loop, remaining data-science. P2 — scale refactors, design-system/a11y/mobile, SAST lane.
    P3 — architecture physical dedup, constant-time hash, CSRF tokens.
37. **Product coherence verdict:** materially improved — from "a collection of subsystems" to "a
    coherent spine with reachable cross-domain intelligence," but not yet the full daily-use product
    across every persona. The orchestrator makes the remaining surfaces thin to add.
38. **Top remaining development gaps:** (1) account/campaign drill-down + creative/commerce/experiment/
    agency/executive surfaces; (2) a live large-account gatherer + the scale refactors it needs; (3)
    provider contract-replay tests + Playwright E2E; (4) live model + a graded eval harness; (5) the
    agency portfolio layer.
39. **Exact external blockers:** live provider OAuth + accounts, a governed model gateway + credentials,
    a connected commerce store, and a deployed environment — all `BLOCKED_EXTERNAL`; nothing live was
    fabricated.
40. **What to develop next:** build the account/campaign drill-down and the creative/commerce surfaces on
    the orchestrator (they compose cheaply now), wire a live gatherer behind the scale refactors, then
    the agency portfolio, then provider contract tests + E2E, then the live model + eval harness.

**Autonomous optimization remains DISABLED. Mode-B provider writes remain HELD. The Phase-0 governed
write chain is unchanged. No live validation was fabricated.**
