# 05 — Architecture Coherence Assessment

**Lens:** staff architect. **Method:** static import grep over `app/`, `lib/markting/`, `test/` and all
migrations @ `affdecc`. Tags: `VERIFIED_CODE` / `PARTIAL` / `MISSING`.

## Coherence verdict: a collection of parallel subsystems, not one product

The seven phases did not build one system. They built one shared **type vocabulary**
(`intelligence/decision-model.ts`) and then five analytical subsystems that (a) have near-zero data flow
between each other and (b) are **not wired into the running application at all.** The live product is a
separate, much smaller path (Assistant → Python engine over HTTP → proposal bridge).

Two independent proofs:
1. **The app imports none of the phase dirs.** Every `markting/*` import under `app/` resolves to 7
   modules: `repository`, `assistant`, `engine-client`, `runtime-mode`, `runtime`, `env`, `bridge`.
   Zero imports of `intelligence/`, `creative/`, `commerce/`, `optimize/`, or `ops/`. `VERIFIED_CODE`.
2. **The live assistant path confirms it** — `assistant.ts` calls no diagnostics, recommender,
   optimizer, or ops governance; `bridge.ts`: "engine proposal → adport preview → Approvals page" is
   the entire shipping product.

## Coupling map (production, non-test)

```
                     [ LIVE APP ]  app/, app/api/
                          |
      assistant ─ bridge ─ engine-client ─(HTTP)→ Python engine (/engine)
      repository, runtime, runtime-mode, env
                          |
           (NO EDGE to any phase subsystem below)
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
     intelligence/decision-model.ts   ← SHARED TYPE HUB (star center)
        exports: BiText, Confidence, Risk, Recommendation, ...
          ▲        ▲        ▲        ▲        ▲
     optimize/  creative/  commerce/  ops/   root files
     (mostly `import type` — erased at runtime)

 Edges BETWEEN the four leaf subsystems (creative↔commerce↔optimize↔ops): ZERO.
```

**Siloed modules (imported by zero non-own-dir, non-test production files): `creative/`, `commerce/`,
`optimize/`, `ops/`.** `intelligence/` is the hub (not siloed) but its own orchestrators
(`analyze.ts`, `recommendation.ts`) are imported only by tests, so it too has no live caller.
`VERIFIED_CODE`.

## Duplicated concepts (debt from parallel phases)

- **Money — 3 definitions.** Canonical `packages/core/src/money.ts` `Money{currency, minor, exponent}`
  ("ONE canonical money representation") is violated by `commerce/model.ts` `CommerceMoney{minorUnits,
  currency}` — **no `exponent` field** → reintroduces the zero/three-decimal currency-rounding bug the
  core type exists to prevent; `intelligence/analysis.ts` carries money as a bare `number`.
- **Trust tiers — 4 parallel vocabularies** (`data-trust.ts`, `memory.ts`, `commerce/model.ts`+
  `commerce/trust.ts`, `intelligence/model.ts`). Provenance reasoning is not comparable across phases.
- **Risk — 3 unrelated meanings** (decision `Risk`, core write `RiskClass`, optimize `riskAdjust`,
  commerce `inventoryRisk`) with no namespacing.
- **Comparability — parallel impls** across intelligence/creative/commerce/optimize (`PARTIAL` on
  behavioral equivalence — not line-diffed).
- **BiText — single, healthy shared type.** The one genuinely good cross-cutting abstraction.

## Store + DB ownership

- **9 bespoke store modules**, one per phase/feature, no shared repository contract — and a **10th**
  (`lib/cloud/repository`) that is the only one the live app uses.
- **DB ownership per migration is clean and disjoint** (bridge, phase2…phase7 each own their
  `markting_*` tables). One smell: `markting_experiments` is created in phase3 but its logic lives in
  `optimize/` (phase6), which adds `markting_experiment_*` — a table family straddling two phases.

## Engine (Python) / platform (TS) boundary — clean

`/engine` is the vendored upstream `paid-media-agent`, consumed never modified; `serve_demo.py` wraps it
with proposal-only guarantees and lives outside `engine/` on purpose. TS reaches it only over HTTP via
`engine-client.ts`, deliberately with **no approve/edit method** ("the engine must never be driven to
execute a write from adport"). Logic is not duplicated across the boundary; the engine proposes, the TS
policy/bridge path is the sole write authority. `VERIFIED_CODE`.

**Drift check caveat (`PARTIAL`/`MISSING`):** the only drift tool
(`platform/scripts/check-connector-catalog.mjs`) compares **connector SDK tool catalogs**, not the
engine↔TS boundary. There is no Python/TS parity/snapshot drift check for the vendored engine; the
boundary stays safe *by construction* (HTTP + no write method), not by a drift test. The CI "drift"
lane is the engine byte-identical-to-upstream check, which is a different guarantee.

## Four parallel recommendation pipelines, none unified, none live

- `intelligence/recommendation.ts` → `Recommendation[]` (canonical type)
- `creative/recommendations.ts` → `CreativeRecommendation[]`
- `commerce/diagnostics.ts` → `CommerceDiagnosis[]` / `generateCommerceRecommendations`
- `optimize/recommendations.ts` → `OptimizationRecommendation`

Four return types, no adapter mapping the three bespoke types to the canonical one, no module importing
two of them, none reachable from the app. The only commonality is `import type { BiText }`. This is the
sharpest evidence of phase-parallelism over coherence. `VERIFIED_CODE`.

## Multi-tenant + provider integration — sound at the data layer

`organization_id` scoping is present in every markting migration; the Phase-5 commerce migration alone
has 28 RLS/policy statements. DB-layer tenant isolation is the strongest part of the estate. **Two
parallel provider frameworks** exist, however: `packages/{google,meta,...}` ad connectors (used by the
live app) and a completely separate `commerce/providers.ts` abstraction for Salla/Zid/Shopify/Woo that
imports nothing from `packages/*`. Each is internally reasonable; the debt is their non-convergence.

## Top 10 architecture gaps

1. **[P0]** The entire phase-2..7 estate is unreachable from the running app.
2. **[P0]** Four parallel recommendation pipelines, none unified, none live.
3. **[P1]** `CommerceMoney` duplicates and weakens canonical `Money` (drops `exponent`).
4. **[P1]** Four independent trust-tier vocabularies.
5. **[P1]** No cross-subsystem orchestration / data flow (zero edges among the four leaves).
6. **[P1]** Two unrelated provider-connector frameworks with no shared base.
7. **[P2]** 9 hand-rolled store modules, no shared repository contract, none the live store.
8. **[P2]** No engine/TS parity or drift check for the vendored Python engine.
9. **[P2]** Split DB ownership for experiments (phase3 table vs phase6 logic).
10. **[P3]** "Risk" overloaded across 3+ domains with no namespacing.

## Bottom line

A rock-solid, coherent **write-safety spine** (vendored engine, proposal bridge, core policy engine,
tenant-scoped schema with RLS) carrying a large, internally-tidy-but-mutually-disconnected analytics
estate that iterative phases accumulated as parallel islands sharing only a type vocabulary. **It is a
collection of subsystems, not yet one product.**

*Limitation:* coupling claims are from static import grep; a dynamic string-keyed registry could in
principle reach a phase module without a static import. The `app/api/v1/tools/[tool]` dispatcher was
independently checked and imports zero `markting/` phase modules, so no such dynamic path was found —
but this is "no static or dispatcher path found," proven by reading, not by runtime tracing.
