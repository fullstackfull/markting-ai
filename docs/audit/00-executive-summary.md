# 00 — Executive Summary (MARKTING-AI)

## How to read this

This is the single-page verdict of a forensic, evidence-based audit of the MARKTING-AI repository (commit `2e68a7f`, verified at the head of this seat's run). It stands on 104 agent reports (96 specialist/lead agents in teams A–J, 8 K-council re-adjudication seats), twelve team deliverables (`docs/audit/01`–`12`), and a business/pricing memo. Every claim below is either a direct code citation (`path:line`, relative to repo root) or a finding ID that can be traced to the register (`docs/audit/11-agent-findings-register.md`) and the council memos (`docs/audit/agents/K*.md`). The K council is the court of record: where specialists disagreed, the K seat's ruling governs, and I carry the ruling's severity, not the louder of the two specialists. Before writing this summary I independently re-read the six most load-bearing citations in code (the sample-mode pin, the demo regex, the zero-decimal currency conversion, the dashboard apply route, the unscoped reports route, and the REST tools write path); **all six held exactly.** Read this document for the decision; read `01`–`12` for the reasoning, and the roadmap `12` for the sequenced plan.

### Classification / severity legend

- **VERIFIED_CODE** — read directly in source at HEAD. **VERIFIED_TEST** — proven by a test in the repo. **VERIFIED_RUNTIME** — reproduced by an agent running the code. **DOCUMENTED_ONLY** — asserted by docs/README, not confirmed in code. **INFERRED** — reasoned conclusion, not a fact. **NOT_VERIFIED** — could not be checked in this sandbox.
- **P0** security / data loss / cross-tenant / unsafe ad execution. **P1** production blocker or serious financial risk. **P2** substantial functional/reliability deficiency. **P3** quality/polish. **GAP** a missing capability the product does not claim to have (not a defect).

---

## What the system IS today (evidence-based)

MARKTING-AI is a **well-guarded, proposal-only approval-and-reporting dashboard with a chat layer, operating entirely over three bundled US-dollar synthetic fixtures.** The engine host refuses to start unless it is pinned to fixture data (`PAID_MEDIA_DATA_MODE` forced to `sample` in *both* demo and live mode), with an empty approver set and the kill switch engaged (`services/engine-demo/serve_demo.py` `assert_fail_closed` at :163-166 and :386; `demo_settings` — VERIFIED_CODE). Consequently **no tenant's real ad account ever reaches the model in any mode** (cluster `serve_demo.py:163,383`; confirmed independently by all six J red-team leads and K1/K2/K7). In the *default* demo mode the "AI" is not a model at all but a keyword regex (`serve_demo.py:63` `WRITE_INTENT`) that selects one of two canned scripts whose recommendation is always a hard-coded Google budget cut (`g-103→240`); live mode wires a real LLM but still only over the same fixtures, and the model receives only `{text}` — no tenant, business, or locale context. What is genuinely real and strong: a fail-closed proposal engine (`ProposalOnlyWriteProvider`), a signed single-use claim with reconciling readback, a deny-by-default engine tool catalog, a test-verified model-output→adport boundary (fixed allowlist + alias map + schema), and a Decimal-based, None-safe, never-average-ratios numeric layer. The product is an honest, defensible **demo of a safety architecture** — not an operating media buyer.

## The verdict: dashboard-with-AI-chat, or intelligent media-buying OS?

**Decisively a dashboard with an AI chat layer — not an intelligent media-buying operating system.** This is the unanimous ruling of the capability council (K1) and the AI council (K2), from code, not opinion. The disqualifying fact is structural and single: the "AI media buyer" never observes the customer's accounts. The capability matrix (deliverable `09`, ratified by K1 across 23 re-opened cells) shows **no cell reaches FULL**; reporting peaks at READ_ONLY; economics, creative, forecasting, allocation, and memory are MISSING; and the engine-sourced analytic cells (budget pacing, blended ROAS, period comparison) are PARTIAL *in code* but **effectively MOCK for real tenant data** because they run only on fixtures (K1 correction; `summary.py:88-104`, `compute.py:278-295` exist exactly as cited but `serve_demo.py:386` forces sample mode). An intelligent OS would observe accounts, hold durable memory, reason about economics and attribution, and close an outcome loop; MARKTING-AI does none of these today (top-gap ordering, K1/K2). It is a credible *skeleton* of such a system with a real safety spine, which is a different and more honest thing than what the "AI media buyer" framing claims.

---

## Finding totals (deduplicated)

From the authoritative register (`docs/audit/agents/_register-totals.json`, written by K10). The **raw** grand total is 1,272 finding-rows across 104 agents (P0=7, P1=146, P2=443, P3=507, GAP=169) — but the A–J corpus heavily cross-reports the same defects and the K layer is explicit re-adjudication of them. The honest figure is the **deduplicated grand total** (connected-components clustering over shared `path:line` tokens at equal severity, a conservative lower bound):

| Severity | Deduplicated count |
|---|---|
| **P0** | **6** (raw); **0–1 adjudicated live-today** |
| **P1** | **52** |
| **P2** | **166** |
| **P3** | **254** |
| **GAP** | **94** |
| **Total distinct defects** | **572** |

**The P0 line is the single most important number to read correctly.** Specialists assigned 6 P0s; the security council (K4) rules **P0 = 0 exploitable today**, because every one is latent on the disabled live-write path (`docker-compose` `PAID_MEDIA_WRITES_ENABLED=false`) or bounded to identical synthetic fixtures. K1 keeps exactly one latent P0 — the zero-decimal currency 100× budget write (`translate.ts:107`, VERIFIED_CODE) — which becomes a real P0 the instant live credentials and a non-two-decimal account are wired. **The correct reading: zero P0 exploitable in the shipped demo; six P0-class defects that activate on the day live data or live writes are switched on.**

---

## Top 10 risks (ordered)

1. **No live-write human approval on adport's own REST/MCP surfaces** — any `tools:write` key holder validates then applies with no second human (`app/api/v1/tools/[tool]/route.ts:5-13`, VERIFIED_CODE; K2-P1-01, K3-03, C13). P1 now, P0-class on live.
2. **Zero-decimal currency 100× budget write** on the live-write path (`translate.ts:107` hard-codes `micros / 10_000` cents; JPY/KRW over-spend 100×, Gulf 3-decimal under-set 10×) — A16 F-01 / K1-05 / K5-10. P1 latent, P0 on live.
3. **Apply is non-atomic across concurrent approvers** — double provider write reproduced 4× at runtime (`approvals/[id]/apply/route.ts:20`; K6-01 / F6). P1.
4. **Cross-tenant engine report index and files** — one global index shared by every tenant; one caller downloaded another's report at runtime (`reports/engine/route.ts:16-20`, VERIFIED_RUNTIME by J2; K-cluster). P2 today / P0 with real data.
5. **Uncapped generic `*_api_update/remove` tools** make status/bid/targeting/destructive changes with no cap or classifier (K2 attempt 9, P1; create-path is coerced PAUSED and budget-checked — the hole is update/remove).
6. **Self-approval guard skipped for null-`created_by` pending rows** on the API-key/MCP path (`apply/route.ts:22`; four-eyes advertised but absent — K4 SEC-26 / C13-03). P2.
7. **Budget caps checked at validate time only; apply re-plans against fresh budget** — cap bypassable (`policy/engine.ts:87,110`; C13 / K4 SEC-07). P2.
8. **Deep Agents summarization leaks a tenant's verbatim chat prose to a shared filesystem root** readable cross-thread/org on a shared process (`deepagents/graph.py:886-889`; C5-01 VERIFIED_RUNTIME, adjudicated P1-now/P0-live by K2).
9. **Replay invariant BROKEN** — the one broken item in K4's 15-invariant table (9 HOLD, 5 PARTIAL, 1 BROKEN); non-atomic apply permits replay (K4, SEC-02). P1.
10. **No usage metering of the dominant AI/engine cost** — only a flat 120 req/min limit, plan-independent (`repository.ts:355`; I3-01 / K8-B3). P1 (unbounded cost / abuse).

## Top 10 product gaps

1. **No tenant-data path to the engine** — the keystone; blocks the core value for all five personas (K1 gap 1, K7; `serve_demo.py:386`). GAP/P1.
2. **No working write loop** — alias→real-account binding has no non-demo writer; a proposal cannot reach a live account (K7, J5-02). GAP.
3. **No economics / business-truth layer** (margins, COGS, LTV — profit is uncomputable) (K1 gap 2). GAP.
4. **No decision intelligence** — no allocation, marginal-ROAS, saturation, or forecasting (K1 gap 4; matrix MISSING). GAP.
5. **Engine channel parity absent** — only a subset of 11 channels have engine analytic depth (K1 gap 5). GAP.
6. **Selling capabilities that do not exist** — `clientWorkspaces` billed on live checkout with a single dead reader (K7-03, P1); SSO/enterprise strings (K7). P1.
7. **Creative and breakdown/audience intelligence missing** (K1 gaps 6-7; matrix MISSING). GAP.
8. **No marketing memory / learning loop** (K1 gap 8). GAP.
9. **Onboarding mis-targeted** — terminal step wires an MCP client instead of the built-in Assistant, and the Free plan strips `tools:write` so the promised preview 403s immediately (K7, P1). P1.
10. **Structurally-0× merchant ROAS tile** that sums across currencies, plus a 0× ROAS display defect and a broken Remove-member path (K5, K7-01, K7). P2.

## Top 10 AI gaps

1. **No live tenant data to the model** — it analyses three US fixtures, not the customer (K2 gap 1; `serve_demo.py:386`). The master gap.
2. **No per-turn tenant/business/locale context** — the model receives only `{text}` (K2 gap 5).
3. **No durable memory / learning / outcome loop** — the pending-sweep that would close it is dormant (K2 gap 6).
4. **Arabic/regional reasoning absent** — chrome is production-grade RTL, but the AI's own analysis, proposals, and reports are English (K7; K2 gap 10).
5. **No significance / sample-sufficiency engine** — 2→3-conversion noise is emitted as a signal (K5; K2).
6. **No creative / frequency / change-history tools or decomposition signals** (K2 gap, matrix MISSING).
7. **No metering / quota / caching** of model cost (K2 gap 8; I3-01).
8. **No tracing / token capture / observability** of model calls (K2 gap 9).
9. **No per-org isolation of workspace, report index, or history** — shared process state (K2 gap; C5, J2).
10. **Default mode is not AI at all** — a regex + two canned scripts, recommendation hard-coded to `g-103→240` (`serve_demo.py:63`, `demo_script.py:156-170`; K2, J1/J4). GAP/representation.

---

## Production-readiness blockers (before a first paying customer)

The repo's own `docs/TODO.md:18-22` and `deployment-model.md:49-58` concede the system is not ready; K8 vouches for **9 P1 blockers**: (B1) no backup/restore; (B2) master encryption key with no KMS/escrow and broken rotation; (B3) no AI-cost metering; (B4) cannot contract under own name — upstream branding throughout; (B5) only destructive `supabase db reset` as a migration path; (B6) no TLS edge; (B7) no root CI, so the tenant-isolation DB suite never runs; (B8) no graceful shutdown/drain; (B9) non-cluster-safe shared state (global report-index file + per-process kill switch). B8/B9 are conditional on operating as a real/scaled service. Eleven P2 should-haves follow (unaudited money-spending apply, no metrics/alerting/tracing, liveness-as-readiness health, retention gap on `markting_*` tables, serverless pool risk, webhook ordering/dunning). The production topology these blockers describe **does not exist in the repo** and could not be built in this sandbox.

## Recommended Phase 0 (the gate everything sits on)

From the roadmap (`docs/audit/12-roadmap.md` §Phase 0, K11; dependency-ordered, no dates). **Nothing that touches a live ad account, a live model, or a second tenant may ship before Phase 0 exits.**

- **R0-01** Make approval-apply atomic and idempotent (closes the double-apply P1).
- **R0-02** Enforce human approval and requester≠approver on **all** write surfaces, including REST/MCP (closes risk #1, #6).
- **R0-03** Cap or retire the generic `*_api_create/update/remove` tools; mirror the engine risk classifier on the adport write path (closes risk #5).
- **R0-04** Fix currency unit integrity for zero- and three-decimal currencies (closes risk #2).
- **R0-05** Assert object ownership on typed writes (meta provider skips `assertObjectOwnedByAccount`).
- **R0-06** Re-check budget/delta caps at apply time (closes risk #7).
- **R0-07** Per-org isolation of the engine report index, report files, and conversation prose (closes risks #4, #8).
- **R0-08** `[PRODUCT DECISION]` Decide the engine multi-tenant model (per-tenant identity, per-thread serialisation, externalised state) before a 2nd replica or live mode.
- **R0-09** `[PRODUCT DECISION]` Resolve the two-Postgres split-brain; establish forward-only migrations for both DBs.
- **R0-10** Stand up root CI with an upstream-edit drift check and the missing authz/concurrency/DB suites (closes B7 and the testing void).
- **R0-11** Encode the 9-rule data-trust floor in code before any surfaced confidence (K5).
- **R0-12** `[PRODUCT DECISION]` Keep the fixture-only fail-closed default; gate alias→real-account binding behind an explicit, audited, human path.

## Recommended AI architecture (decisions ratified by the council)

Five governed layers in a **safety-first sequence** (K2, deliverable `03`):

1. **AI Gateway** — ship the Option-A safety items (allowlist, deadline, circuit breaker, token capture) unconditionally; a self-hosted Option-B gateway is **required at multi-tenant live**, before any tenant data reaches the model.
2. **Intelligence Layer** — tenant-scoped context delivered via a **new engine context field** (the model today gets only `{text}`); live tenant-data read path lands only behind the Phase-0 gate.
3. **Marketing Memory** — in adport Postgres, with **human-confirmed facts only**; no learned value may ever change a budget/safety limit.
4. **Recommendation pipeline** — a **single** human-gated, metered, observable write path, with the engine risk classifier **mirrored on the adport write path** and the generic `api_*` tools **retired**.
5. **Outcome loop** — built on the currently-dormant pending sweep, to attribute results back to proposals.

---

## Contradictory findings needing the owner's resolution

The council resolved almost every tension from code (see each K memo). Three items remain genuinely open and are the **owner's to decide**, because they turn on deployment/runtime facts not decidable from the repo:

1. **SEC-04 — P1 vs P0 (Next.js image-optimization RCE).** Turns on whether `next/og`/image-optimization is reachable from any route; neither E9 nor K4 traced route reachability (K4, NOT_VERIFIED). *Owner must trace route reachability in the deployed app.*
2. **SEC-01 / reports IDOR — P1 vs P0.** Turns on production topology: multiple orgs on one engine process plus a real-data report host wired to the unscoped routes (K4, NOT_VERIFIED; `docker-compose` shows a single engine, consistent with but not proof of the risk). *Owner must declare the multi-tenant engine topology (R0-08).*
3. **Live-mode trigger for the cross-tenant prose/report leak — P1-now vs P0 (C5 vs K2/C14).** The council resolved it to **P1 today / P0 the moment live per-org reads are enabled**; C5's "by construction, latent in default config" mechanism is correct and preserved, C14's discipline (ad-data confidentiality is not breached while every org sees identical fixtures) is also correct. The one sub-path where it is a P1 *now* regardless of fixtures: `/conversation_history` exposes a tenant's own verbatim prompts to other threads on a shared process (`serve_demo/local.py:28-50`). *Owner must confirm whether live per-org reads will share one engine process.*

A fourth, lower-stakes open item: the **self-approval env default diverges across two `.env` templates** (K4 noted PARTIAL on two of 24 spot-checks) — a configuration decision, not a defect, but the owner should pick one default.

## Exactly what was NOT verified in this sandbox

By construction, the following could not be exercised and are recorded as **NOT_VERIFIED** (a production gate in their own right): **live-model behaviour** (no live credentials; the host refuses them); **Docker image contents and the full compose stack** (not built); **DB concurrency under real load and the two-Postgres split-brain** at runtime; **live Stripe/OAuth/model integrations**; **a real Supabase** and the destructive `db reset` migration path; **a backup/restore drill**; **the MDA (managed) deployment path**; **all dollar figures** in the business memo; **browser/RTL end-to-end flows**; and **route reachability for the Next.js RCE** (SEC-04). The Node half of the test suite could not run in this sandbox's offline corepack state (K8 resolved this as a sandbox/CI-pin artifact, not a code defect — F1 had previously run 308 cloud tests green at `d9c79f6`). No audited command runs in any CI today (K6).

## The audit's own method and limits

**Scope & method.** 104 agents filed reports: 96 specialist/lead agents across teams A–J (channel/capability, business-truth, concurrency/architecture, security, test-coverage, product, pricing, and an independent red team) and 8 K-council re-adjudication seats, each of which re-read the load-bearing citations in code before ruling. Repository code at HEAD (`2e68a7f`) was the sole source of truth; README/UPSTREAM/docs and prior reports were treated as claims to verify. The register's deduplicated total (572 distinct defects) is a conservative lower bound built by clustering shared `path:line` tokens.

**Coverage & reliability.** No A–J agent failed to file (register `no_report: []`); **K9 is absent by design** (its red-team-adjudication role folded into K4/K2), which the register records as a planned absence, not a coverage gap. Commit drift exists across the skeptic cohort (J1/J2 at `49817c5`, J4 at `d9c79f6`, J5/J6 at `f869936`, HEAD `2e68a7f`), but `engine/` is byte-identical to its import commit (`git log -- engine/` → single commit `4162146`) and every cited glue line re-verified at HEAD, so this is a recorded caveat, not a contradiction. Primary spot-check rate across the K layer was very high (K2 15/15 held with one PARTIAL; K4 22/24; K3 26/27; K10 all five A–J P0 citations held). **Residual confidence: ~0.85**, with the residual concentrated entirely in the un-runnable envelope above. The genuine limit of this audit is that it is a **static, read-only** examination: it proves what the code *is* and *does when invoked in-process*, but it cannot prove how the un-built production stack behaves under live credentials, real tenants, and concurrent load — precisely the conditions under which the six latent P0-class defects activate.

---

*Executive summary prepared by council seat K12. Sources: `docs/audit/01`–`12`, `_business-and-pricing-architecture.md`, `docs/audit/agents/K1`–`K10`, and `_register-totals.json`. Load-bearing citations independently re-verified in code at HEAD `2e68a7f`.*
