# 13 — Master Gap Register (mandatory artifact)

**What this is:** every gap from all nine independent audits, de-duplicated, ranked P0→P3, with the
verification tag and the domain(s) that found it. "Found by" lists the team docs that independently
derived it (A=media-buyer, B=AI, C=UI/UX, D=product, E=arch, F=security, G=test, H=data-science,
I=scale, J=red-team). Convergence across many teams is itself evidence.

Priority meaning here (assessment context): **P0** = blocks the product being a usable/sellable product
or is a live security defect; **P1** = blocks a core persona or a whole value prop; **P2** = material
quality/scale/correctness debt that blocks a surface when wired; **P3** = hardening / polish.

---

## P0 — product-defining or security-critical

| ID | Gap | Tag | Found by |
|---|---|---|---|
| P0-1 | **The entire Phase 2–7 intelligence estate (creative, commerce, optimize, ops, and the intelligence orchestrators) is imported by ZERO `app/` files** — 89/118 `lib/markting` files are reachable only from tests. The product's advertised value is unreachable code. | VERIFIED_CODE | A B C E J (all) |
| P0-2 | **The live "AI" assistant is a scripted demo engine** (`serve_demo.py` `LoopingScriptedChatModel`); no LLM SDK in `package.json`; no live model wired as a product integration. | VERIFIED_CODE + DOCUMENTED_ONLY | A B J |
| P0-3 | **No orchestration layer composes domains** — the cross-domain "why did profitability decline and what should I do?" question is unanswerable even by the dormant stack (`analyzeAccount` ignores commerce/memory/history). | VERIFIED_CODE | B E |
| P0-4 | **No "what needs attention" / triage surface and no decision surfaces** (allocation, diagnosis, creative, pacing) — a buyer cannot run accounts better in the morning; 8/50 benchmark questions answerable. | VERIFIED_CODE | A C |
| P0-5 | **Two Phase-1 tables (`markting_ai_usage`, `markting_business_context`) have no RLS, no deny policy, no revoke** — cross-tenant exposure under standard Supabase defaults; deviates from the house convention used on every other table. | VERIFIED_CODE (lead-confirmed) | F |
| P0-6 | **No real provider contract/replay tests** — all 11 providers verified only against self-authored fixtures; a provider API change passes CI but breaks production. | VERIFIED_TEST | G |
| P0-7 | **No browser/E2E coverage** of the core user journey anywhere; the genuine agent eval isn't CI-collected. | VERIFIED_TEST | G |
| P0-8 | **Analytics read path can't serve a dashboard at scale** — `effectivenessRows` loads three full tables/org and joins in JS; zero caching. (Latent until wired; a release-blocker for the surface that wires it.) | VERIFIED_CODE | I |

## P1 — blocks a core persona or value prop

| ID | Gap | Tag | Found by |
|---|---|---|---|
| P1-1 | No commerce/store connection → no MER, profit, or reconciliation UI (whole e-commerce value prop dead). | BACKEND_ONLY | A C |
| P1-2 | No creative-intelligence surface (fatigue/clusters/hooks) despite built `creative/*`. | BACKEND_ONLY | A C |
| P1-3 | No campaign/ad management or performance drill-down UI — humans can't pause/bid/breakdown without an external agent. | VERIFIED_CODE | A C |
| P1-4 | No agency portfolio layer (client grouping, roll-up, triage, FX aggregation); paid `clientWorkspaces` has no UI. | VERIFIED_CODE | A C |
| P1-5 | No pacing / budget-burn / anomaly-alert feed. | BACKEND_ONLY | A C |
| P1-6 | No experiments / optimization / allocation UI. | BACKEND_ONLY | A C |
| P1-7 | No outcome→advice learning loop — `generateRecommendations` takes no memory/outcome input; history never improves advice. | VERIFIED_CODE | B |
| P1-8 | AI gateway has no multi-provider routing and no provider fallback; roles incomplete (no VISION/EMBEDDING). | VERIFIED_CODE | B |
| P1-9 | Four parallel recommendation pipelines, four return types, no adapter/unifier. | VERIFIED_CODE | E |
| P1-10 | `CommerceMoney` drops the `exponent` field and re-implements money math, weakening the canonical `Money` safety. | VERIFIED_CODE | E H |
| P1-11 | Four independent trust-tier vocabularies — provenance reasoning not comparable across phases. | VERIFIED_CODE | E |
| P1-12 | Sample-size formula returns a visitor count compared against conversions (~1/p too strict); conflates relative/absolute MDE. | VERIFIED_CODE | H |
| P1-13 | Anomaly uses a global in-sample baseline (not rolling) → trend false-positives + spike masking; day-of-week keyed off `index % 7` with no date anchor. | VERIFIED_CODE | H |
| P1-14 | Reconciliation variance thresholds are flat constants not scaled by order count → false alarms on small accounts. | VERIFIED_CODE | H |
| P1-15 | CAC/MER assume spend and conversions/refunds fall in the same window — no conversion-delay cohorting. | PARTIAL | H |
| P1-16 | Revenue gross-sales reconstruction hard-codes a platform-specific discount convention (double-count risk). | VERIFIED_CODE | H |
| P1-17 | Commerce ingestion N+1: `upsertOrders` delete + per-line insert, sequential, no transaction. | VERIFIED_CODE | I |
| P1-18 | Analysis engines silently truncate at a 5000-row `select *` cap with no "incomplete" signal. | VERIFIED_CODE | I |
| P1-19 | RLS proven for only a handful of tables; no systematic policy-regression coverage; no service-role bypass test. | VERIFIED_TEST | G F |

## P2 — quality/scale/correctness debt (blocks a surface when wired)

| ID | Gap | Tag | Found by |
|---|---|---|---|
| P2-1 | No SCA/SAST dependency-scan lane in CI. | MISSING | F |
| P2-2 | "AI Evaluation" suites are deterministic unit tests, not model evals; no live-model regression gate in CI. | VERIFIED_TEST | B G |
| P2-3 | UI tests are static-render string matching; the one LLM-touching test fakes the model. | VERIFIED_TEST | G |
| P2-4 | Missing sort-key indexes (`creatives (org, updated_at desc)`, `orders (org, created_at_src desc)`); several unbounded list queries (timeline, outcomes, memory). | PARTIAL | I |
| P2-5 | Observation-job worker has a global batch of 50 with no per-org fairness. | PARTIAL | I |
| P2-6 | Forecast band assumes i.i.d. daily values (√horizon) → too-narrow bands / false precision. | VERIFIED_CODE | H |
| P2-7 | Response-curve marginal/saturation from noisy finite differences on observational spend-sorted points. | VERIFIED_CODE | H |
| P2-8 | Pacing projection unstable early in period (no min-elapsed guard); "timezone-aware" docstring with no timezone code. | VERIFIED_CODE / MISSING | H |
| P2-9 | Universal `MIN_SAMPLE=30` applied to value-weighted ROAS, ignoring order-value dispersion. | VERIFIED_CODE | H |
| P2-10 | Findings require an external agent to trigger `audit_run` (no dashboard button); only 4 campaign-level rules. | VERIFIED_CODE | A J |
| P2-11 | No usage/cost visibility; health & kill-switch not surfaced in UI. | BACKEND_ONLY | A C |
| P2-12 | 9 hand-rolled store modules, no shared repository contract; two unrelated provider-connector frameworks. | VERIFIED_CODE | E |
| P2-13 | No engine/TS parity-drift check for the vendored Python engine. | PARTIAL/MISSING | E |
| P2-14 | No migration rollback / destructive-change testing (CI runs `migration up` only). | VERIFIED_TEST | G |
| P2-15 | Multimodal gateway is a non-functional scaffold (metadata-only, everything UNKNOWN). | VERIFIED_CODE | B |

## P3 — hardening / polish

| ID | Gap | Tag | Found by |
|---|---|---|---|
| P3-1 | Service-account hash compare not constant-time. | VERIFIED_CODE | F |
| P3-2 | No explicit CSRF token (cookie-SameSite reliance, not verified pinned). | PARTIAL | F |
| P3-3 | Prompt assembly / instruction-isolation lives in the external engine (unverifiable from this repo). | PARTIAL | B F |
| P3-4 | Phase-5 `delete` grant broader than sibling tables. | VERIFIED_CODE | F |
| P3-5 | Design system has no data-viz primitive; dense tables don't reflow on mobile; no skip-link; tables lack `scope`/`caption`. | VERIFIED_CODE | C |
| P3-6 | "Risk" overloaded across 3+ domains with no namespacing; split DB ownership for experiments (phase3 table vs phase6 logic). | VERIFIED_CODE | E |
| P3-7 | `observedLTV` mixes net/gross basis; zero-denominator ratios reported as 0 not undefined. | VERIFIED_CODE | H |

---

## Count

- **P0: 8** (1 security, 7 product/architecture/test).
- **P1: 19.**
- **P2: 15.**
- **P3: 7.**

## The one P0 that is a fix-now defect regardless of roadmap

**P0-5** (two Phase-1 tables missing RLS) is the only P0 that is a discrete security defect independent
of the product-build decision. It is held this mission (assessment-only) but is the **first item** in
the first program of the roadmap (`14`). Every other P0 is a build-scope decision, not a patch.
