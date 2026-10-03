# Phase 4 — Exit Report

Creative Intelligence, Multimodal Analysis, Fatigue Detection & Creative Learning.
**ANALYSIS ONLY — no provider-write capability was added.**

The 36-item final response required by the mandate:

1. **Branch** — `claude/amazing-heisenberg-0unnak`.
2. **HEAD** — `5a51cc6` (built on Phase-3 exit `299460c`).
3. **Commits** — `5344357` (creative engine + migration + tests) and `5a51cc6` (expert red-team fixes +
   grants-fixup migration + docs 01-10 + log + this report).
4. **Migrations** — `20261007000000_phase4_creative.sql` (6 tenant-scoped tables, FK'd, indexed, grants,
   RLS + revoke) and `20261008000000_phase4_creative_grants_fixup.sql` (grants the missing UPDATE on
   `markting_creative_assets` — its upsert uses `ON CONFLICT DO UPDATE`, which needs UPDATE, not just
   INSERT — plus idempotent grant/RLS re-assertion + a membership reverse index). Forward-only.
5. **Creative canonical entities** — `creative/model.ts`: `Creative` (provider/account/campaign/adgroup/
   ad ids, media type, status, lifecycle timestamps, raw bag) + `CreativeAsset`, `CreativeText`,
   `CreativePerformance` (per-currency, never blended), `CreativePlacement`, `CreativeVariant`,
   `CreativeClusterRef`, `CreativeSignal`; deterministic `creativeId(provider, account, rawId)`.
   **SYNTHETIC_PROVEN** (no live creative API here).
6. **Ingestion** — normalized through the typed provider boundary; fixtures only (live transport
   **BLOCKED_EXTERNAL**). No fabricated "live" proof.
7. **Performance** — `performance.ts#creativeShares` (currency-safe: `spendShare:null` on mixed
   currency) + `rateCreative` (cohort-relative; low-spend/thin → `INSUFFICIENT_DATA`, never a loser).
8. **Lifecycle** — `creativeLifecycle`: NEW/LEARNING/MATURE/DECLINING/DORMANT/RETIRED from EVIDENCE
   (delivery + trend), not age alone.
9. **Fatigue** — `fatigue.ts`: multi-signal (frequency pressure, falling CTR, rising CPC, declining
   CVR/ROAS, CPM-not-falling, aged) → NO_SIGNAL/WATCH/FATIGUE_SIGNAL/STRONG/INSUFFICIENT_EVIDENCE.
   Never one metric; **CPM is a HARD GATE** (falling/unknown CPM → held at WATCH, never confirmed);
   never "proven".
10. **Change-point** — reuses Phase-3 `timeline.ts`: a creative launch near a metric move is a
    `TEMPORAL_ASSOCIATION`, never a cause.
11. **Text classification** — `classify.ts`: deterministic bilingual (en/ar) taxonomy match with
    evidence spans; ad copy is DATA, never instructions.
12. **Hook taxonomy** — 12 hooks + OTHER/UNKNOWN/MULTIPLE (not claimed universal).
13. **Angle taxonomy** — 13 angles + OTHER/UNKNOWN; extensible.
14. **Visual schema** — `visual.ts`: tri-state PRESENT/ABSENT/UNKNOWN; **all UNKNOWN without a model**
    (no fabrication); **no field for any protected trait or identity**.
15. **Video schema** — same discipline; transcript carried as DATA only.
16. **Multimodal gateway** — `multimodal-gateway.ts` over the Phase-1 governed `AiGateway`: size/
    duration limits, content-hash cache, per-org ledger accounting; **provider creds never sent**;
    metadata-only `local_fallback`. Live multimodal **BLOCKED_EXTERNAL**.
17. **Hashing / dedup** — `dedup.ts`: EXACT_DUPLICATE/LIKELY_VARIANT/RELATED/DISTINCT; distinct
    creatives are **never merged on copy alone** — the only merge path is a confirmed shared media
    hash; `dedupGroups` is O(N) (media-hash bucketing).
18. **Clustering** — `clustering.ts`: explainable O(N) feature-key clusters (media|hook|angle|format|
    cta); currency-safe (mixed → `spend:null`, ratios undefined), ordered by currency-agnostic
    conversions.
19. **Winner / loser** — `rateCreative` STRONG_PERFORMER needs both ROAS and CPA to beat a comparable
    cohort; a thin/low-spend creative is never a loser.
20. **Comparability** — `creativeComparability`: hard blockers (currency, objective) → NOT_COMPARABLE;
    audience/attribution/window → PARTIALLY_COMPARABLE.
21. **Contribution** — `creativeContribution`: never blames the creative when CPM moved the number;
    unknown CPM on an efficiency metric → `INSUFFICIENT_EVIDENCE` (no false "media cost stable").
22. **Recommendations** — `recommendations.ts`: 8 review-only categories, typed labels with evidence/
    confidence/risk/trust/comparability — **no endpoint/path/body**, `requiresHumanApproval:true` always.
23. **Test ideas** — `creativeTestIdea`: `kind:'HYPOTHESIS'`, control/treatment/guardrails/required-
    evidence — never launched.
24. **Creative memory** — `store.rememberCreativePattern`: reuses Phase-3 memory; a DERIVED pattern
    below `MIN_SAMPLE_FOR_CONFIDENCE` is REFUSED ("blue backgrounds always win" from n=3 cannot persist).
25. **Outcome linkage** — recommendation → human action → new creative → observation → outcome reuses
    the Phase-3 decision-events + observation-jobs + outcome engine (no auto-generation/publishing).
26. **Surfaces** — `surfaces.ts`: Library (groups/filters), Detail (row + signals + cluster), Dashboard
    (always sample sizes + a no-global-average caveat), Ask (7 intents, cites evidence + comparability
    caveat, video-vs-image gated), Morning brief (materiality-prioritized, bounded).
27. **Injection defense** — ad copy / transcripts are matched to a taxonomy and stored as evidence
    spans, never executed; an "ignore your system prompt" string classifies as ordinary copy. Tested.
28. **Cost control** — gateway size/duration caps + content-hash cache (unchanged asset never
    re-analyzed) + per-org ledger; oversize rejected (`INVALID_INPUT`) before any model call.
29. **Analysis versioning** — `markting_creative_analysis` is versioned (version + model + source_hash)
    and insert-only; sourceless types use a `''` sentinel so re-analysis is idempotent (no row bloat),
    and no prior version is ever overwritten.
30. **Provider matrix** — `02-provider-creative-matrix.md`: per-provider creative-field coverage;
    typed-read parity carry-forward judged DEFERRED (not overstated as live).
31. **Evaluation 4.0** — `test/phase4-eval.test.ts`: 25 creative scenarios (numerical, classification,
    fatigue restraint, non-causal language, comparability, security, provenance, uncertainty,
    bilingual). All pass. (`09-evaluation.md`.)
32. **Red team** — independent expert panel (`10-security-red-team.md`): invariants HOLD; 6 PARTIAL
    gaps + 1 concrete DB bug fixed with regressions (`test/phase4-redteam-fixes.test.ts` + DB
    idempotency case).
33. **Performance** — clustering and dedup are O(N) single-pass (bucketing), validated by design and
    by the grouping tests; `listCreatives` is bounded (limit 5000) and indexed on the hot lookups.
34. **Database** — 6 forward-only tenant-scoped tables, composite FKs, RLS (restrictive server-only +
    backend policy, anon/authenticated revoked); DB-gated suite proves tenant isolation, versioned
    insert-only analysis, NULL-source_hash idempotency, and the creative-memory sample guard on a real
    Postgres (CI `cloud-db` lane). **RUNTIME_PROVEN.**
35. **Gates A–I** — see the table below.
36. **Everything still unproven** — live provider creative ingestion (Meta/TikTok/Google/Snapchat
    transport + OAuth), live image/video multimodal analysis (visual/video verdicts are `UNKNOWN` by
    design until a model is wired), and any real-world creative outcome learning (needs live launches
    + observation windows). All **BLOCKED_EXTERNAL** — infrastructure/credentials absent in this
    environment, never faked.

## Gates

| Gate | Criterion | Verdict |
|------|-----------|---------|
| A | Canonical creative model + tenant-scoped persistence | **PASS** (RUNTIME_PROVEN, CI DB lane) |
| B | Deterministic performance / lifecycle / fatigue, evidence-gated | **PASS** |
| C | Bilingual text / hook / angle classification, copy-as-data | **PASS** |
| D | Dedup + explainable O(N) clustering, currency-safe | **PASS** |
| E | Visual/video multimodal | **PARTIAL** — schema + gateway + no-fabrication fallback built; live model **BLOCKED_EXTERNAL** |
| F | Review-only recommendations + HYPOTHESIS test ideas, human-approval-always | **PASS** |
| G | Creative memory + outcome linkage, sample-gated, no auto-mutate | **PASS** |
| H | Evaluation 4.0 + expert red-team, findings fixed | **PASS** |
| I | DB isolation / RLS / versioning / injection defense on real Postgres | **PASS** (RUNTIME_PROVEN) |

## CI

Final validating run on HEAD `5a51cc6`: **run `37125729756`** (workflow_dispatch, all six lanes —
node, cloud-db real-Postgres, engine, drift, infra, security). _Verdict confirmed green below once the
run completes._

## Safety attestation

No provider-write capability exists in Phase 4. Recommendations and test ideas are typed review labels
with no endpoint/body and `requiresHumanApproval:true`. The registry read-only gate and the Phase-0
human-approved write path are unchanged. Historical/creative memory is never authority to mutate an ad
account. Visual analysis infers no protected trait and identifies no individual.
