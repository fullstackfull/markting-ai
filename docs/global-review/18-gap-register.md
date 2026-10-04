# 18 — Gap Register (P0–P3)

Reconciled from all 16 independent reviewers. Each gap: evidence · user impact · competitor benchmark
(where verified) · recommended fix · code-solvable? · priority. "Recurring" = flagged by ≥3 reviewers
independently (highest confidence). This is an assessment gate — these are NOT implemented here.

## P0 — prevents safe/real use
- **G-P0-1 No live value loop (RECURRING: 01,02,03,06,07,10,15,16).** `lib/cloud/intelligence.ts:46` is binary: `demoGatherer` (synthetic seed) or `emptyGatherer` (NOT_CONNECTED). No live gatherer converts real provider `ReportRow`→`MetricObservation`→engines. **Impact:** on a real connected account every flagship intelligence/assistant/executive/creative/commerce surface renders EMPTY; the product analyzes only a fixed fake account. **Benchmark:** every live rival (Madgicx/Revealbot/Smartly) runs on real data. **Fix:** build a live gatherer (`reads.ts` ReportRow → MetricObservation) feeding the orchestrator. **Code-solvable:** yes (the engines already exist). 
- **G-P0-2 Overview KPI tile sums platform-claimed conversions cross-provider (09).** `app/dashboard/live-data.tsx:36-58` sums provider-reported conversions into one number + single-currency blended ROAS, footnoted only "Provider-reported", no double-count caveat — the exact cross-channel-summing error the library's own `cross-channel` gate forbids, and it is the headline live number. **Impact:** misleads on the one number a connected buyer sees. **Fix:** per-provider breakdown + explicit "not additive across attribution systems" caveat, or remove the blended total. **Code-solvable:** yes (small, localized).
- **G-P0-3 "AI" positioning overclaim (15, corroborated 10,14).** No model SDK in `platform/apps/cloud`; `AiGateway` always `localFallback`; "Ask Markting AI" is a regex intent router. The name/positioning implies a live AI agent that does not exist. **Impact:** truth-in-marketing / trust. **Mitigation present:** in-app deterministic/LOCAL_FALLBACK labels. **Fix:** either wire a live model or soften external "AI" claims to "deterministic intelligence + (coming) AI". **Code-solvable:** yes (positioning) / partly (live model = BLOCKED_EXTERNAL).

## P1 — prevents professional adoption
- **G-P1-1 No live model wired (10,14,15,16)** — AI gateway dormant; the narrator-grounding invariant is unproven against a real model. BLOCKED_EXTERNAL (needs a model + budget).
- **G-P1-2 Money shown as raw unlabeled minor units (RECURRING: 01,07).** e.g. "CPA: 3684" / "spend ≈ 1680000" = 16,800 SAR. `formatMoney` exists (`money.ts:59`) but intel surfaces (`sections.ts:69`, `intel.tsx:27`) don't use it. ~100x readability/trust hazard. **Fix:** apply `formatMoney`. Code-solvable: yes (trivial, high-value).
- **G-P1-3 No date-range / time control (01,13).** No "yesterday"/MTD/custom range anywhere; windows frozen. Disqualifying for daily use. Code-solvable: yes.
- **G-P1-4 Flagship diagnosis + materiality hard-coded (01,07).** `demo-gatherer.ts:67` headline/materiality are canned strings, not computed from the seed (only drill-down sections run real engines). Code-solvable: yes.
- **G-P1-5 No ad-set/ad-group tier; social-native dims absent (01,06).** Normalized model = 10 generic metrics; no frequency/reach/placement/video/audience/learning-phase. Structural miss for Meta/Google. Code-solvable: yes (model + fetch expansion).
- **G-P1-6 Tenant `audit_events` not DB-enforced append-only (12).** Backend role has blanket UPDATE/DELETE; "immutable" is convention (contrast `platform_admin_audit`, which is enforced). Fix: REVOKE + deny-trigger. Code-solvable: yes (cheap).
- **G-P1-7 Commerce dormant end-to-end (03,06).** Connectors read-only, no live transport/ingress route/background sync runner. The profit differentiator can't run on a real store. BLOCKED_EXTERNAL + runner work.
- **G-P1-8 Entity/brand/legal (16).** Data-controller, support and enterprise CTAs still reference the upstream author/brand. Must contract under MARKTING-AI's own entity. Code-solvable: yes (content/legal).

## P2 — major competitive weakness
- **G-P2-1 Single-layer tenant isolation (11,12).** `adport_backend` has `using(true)` on tenant tables; isolation rests on hand-written `where organization_id`. No RLS backstop; a cross-tenant RLS P0 already shipped once. Fix: add tenant RLS defense-in-depth.
- **G-P2-2 No SSO/SAML/SCIM/OIDC/MFA (11).** Fails enterprise procurement. ("SSO" only in billing copy.)
- **G-P2-3 No incrementality/MMM/holdout; no significance testing; biased CPA forecast mean-of-ratios (08,09).** Not a primary measurement system vs Northbeam/Triple Whale.
- **G-P2-4 Creative: strong engine is dead code; no asset rendering/multimodal (04).** Shipped surface = thin 5-row synthetic table; materially worse than native.
- **G-P2-5 Search depth absent; Meta-centric (05).** No search-term/negative-keyword/impression-share/quality-score/PMax/Shopping; Google is execution-only on a Meta-shaped brain.
- **G-P2-6 Operator table mechanics missing (13).** No global search/sort/pagination/date-range; 21-item flat nav; no mobile nav.
- **G-P2-7 Credential key management (11).** Single static env key, `key_version` hard-wired to 1; KMS/BYOK/per-tenant keys exist in code but unwired; no residency.
- **G-P2-8 AI cost metering + Gulf billing (16).** Inference unmetered/unpriced; billing EUR-only, no VAT/SAR despite Gulf-first.

## P3 — improvement
- Forecast band coverage labeling + threshold calibration/backtesting (08).
- Attribution windows hardcoded/undisclosed/non-configurable (06,09).
- Two coexisting i18n patterns; inline bilingual consts vs catalog (13).
- Explicit CSRF/origin token beyond SameSite (12).
- E2E test-login route ships gated by env flag — prod hygiene dependency (12).
