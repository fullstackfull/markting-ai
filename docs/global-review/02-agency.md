# MARKTING-AI — Independent Agency Review

**Reviewer role:** Global agency media buyer managing dozens of clients across markets, currencies, timezones and teams.
**Evaluation lens:** Can MARKTING-AI function as an *agency operating system*? Can I start my morning here and know which 5 clients need attention first?
**Runtime:** DEMO mode with synthetic fixtures; no live credentials.
**Date:** 2026-10-04. Every claim below is grounded in code I opened; file paths cited inline. External comparisons are dated and sourced.

---

## 1. Executive verdict (read this first)

MARKTING-AI contains a **genuinely good conceptual spine for an agency OS** — a deterministic client-attention ranking, a currency-safety model that refuses to lie, strong account isolation primitives, and an append-only audit trail. But as a *working* agency operating system it is **demo-only scaffolding**:

- The agency portfolio is backed by **three hard-coded synthetic clients** (`lib/markting/orchestrator/seed.ts:275-279`). There is no path to dozens of clients. "Which 5 clients need attention first?" is literally unanswerable — there are only three, and only in DEMO.
- In **live mode the entire agency surface is empty**: the portfolio section returns nothing (`lib/markting/orchestrator/demo-gatherer.ts:20-29`), and the client switcher renders `null` (`components/client-switcher.tsx:17`).
- The sophisticated machinery that would make this an agency OS — an 8-role RBAC/ABAC model, a multi-client scope resolver, an enterprise multi-approver quorum policy, and an alerting engine — **exists in libraries and tests but is not wired to any route or UI**.

**Adoption verdict: WOULD_PILOT** — worth a pilot for the safety model and the attention-ranking concept, but it **cannot run daily agency operations today** and would be WOULD_NOT_USE if judged purely on live-mode capability.

---

## 2. What actually happens when I open the product each morning

The left nav (`components/nav.tsx:27-50`) is a flat list of ~20 items (Overview, Workspace, Assistant, Recommendations, Creative, Commerce, Experiments, Agency, Executive, Connections, Accounts, Reports, Findings, Approvals, Audit, Data Quality, Governance, Agents, Policies, Team, Plan). There is no agency-first information architecture — no "morning queue", no unread/alert badges, no per-client grouping.

**Agency page** (`app/dashboard/agency/page.tsx`): loads a single `PORTFOLIO_ATTENTION` section and renders a "Client health queue". This is the closest thing to a morning triage view and the concept is right (see §3).

**Executive page** (`app/dashboard/executive/page.tsx`): despite the "agency" framing, it is scoped to **one client** — `loadWorkspaceIntelligence(tenant, 'PROFITABILITY_DECLINE')` resolves to the primary demo account only (`demo-gatherer.ts:36`, `seed.ts:284-287`). It is a single-account executive summary, not an agency-wide rollup.

So the honest answer to "can I triage my book of business each morning": **in DEMO, partially** — I get a ranked list of 3 clients with reasons. **In LIVE, no** — the portfolio is empty, there are no alerts, and I cannot even switch clients.

---

## 3. Dimension-by-dimension evidence and scores (0–5)

### 3.1 Cross-client portfolio overview & attention ranking — **2/5**
`buildPortfolio()` (`lib/markting/orchestrator/sections.ts:265-282`) computes a **deterministic attention score** per client with transparent, inspectable reasons:
- Stale data sync +30; CPA deteriorating on largest campaign +40; creative fatigue +20; platform-vs-merchant variance +25; pending recommendation outcome +10. Clients are sorted desc and the summary names who needs attention first.

This is exactly the right primitive for an agency triage queue, and it is a *real computation* over the engines, not a canned string. **But**: only 3 static seed clients (`seed.ts:275-279`); the ranking is demo-only (live returns nothing); there is no pagination, no search ("Free-text client search is a later enhancement" — `client-switcher.tsx:13`), no trend/time dimension, no drill-through from a row to a client workspace. The score weights are hard-coded with no org configuration. Strong concept, demo-only implementation that does not scale to "dozens of clients".

### 3.2 Client switching — **1/5**
`ClientSwitcher` (`components/client-switcher.tsx`) is rendered in the shell with **no `activeAccountId`** (`components/shell.tsx:29`), so it always shows the first seed client as active. It lists the 3 seed clients in DEMO and **returns `null` in live mode** (line 17). Worse, `requireDashboardTenant()` selects a **single membership** — `order by membership.created_at asc limit 1` (`lib/cloud/dashboard.ts:38-41`) — so a user who belongs to multiple client organizations is pinned to their oldest one with **no org/client switcher at all**. For an agency where "switch to client X" is the most frequent action of the day, this is a blocker.

### 3.3 Multi-currency safety — **4/5** (a real strength)
`lib/markting/optimize/fx.ts` is principled and well-implemented: cross-currency allocation is **blocked unless a governed rate source is supplied**; every conversion records source + rate + timestamp; **an LLM-provided rate is never accepted**; without a governed rate, cross-currency candidates are `NOT_COMPARABLE` (`crossCurrencyAllowed`, `convertToBase`). The portfolio explicitly refuses to blend currencies into a fake total and keeps each client in its own currency (`sections.ts:281` note; three currencies in the seed: SAR/AED/EGP). This is more disciplined than most commercial agency dashboards, which happily sum mixed currencies. Points off only because there is **no governed FX registry wired into any surface** and **no aggregated multi-currency portfolio view** to exercise it — the safety is real but currently protects a feature that doesn't exist yet.

### 3.4 Permissions / RBAC — **2/5**
Two parallel, **disconnected** permission systems:
- A rich 8-role ABAC model with segregation-of-duties — `OWNER, ADMIN, MEDIA_BUYER, ANALYST, APPROVER, VIEWER, AGENCY_ADMIN, CLIENT_ADMIN`, per-permission grants, "AI can never approve/execute", "service account can't satisfy human approval" (`lib/markting/ops/rbac.ts`). This is genuinely good design.
- The **actual product** only knows four roles — `owner | admin | member | viewer` (`lib/cloud/types.ts:7`), and the team UI only lets you assign admin/member/viewer (`app/dashboard/team/team-members.tsx:58-78`).

`ops/rbac.ts`'s agency roles (`AGENCY_ADMIN`, `CLIENT_ADMIN`, `MEDIA_BUYER`, `APPROVER`, `ANALYST`) **cannot be assigned anywhere in the UI**. The sophisticated model is reachable only from the ops write-path library and tests. An agency cannot express "this buyer sees clients A/B, that approver covers the EMEA pod" in the product.

### 3.5 Account isolation / multi-tenant — **4/5** (a strength)
Isolation primitives are solid. `createAccountScopeAuthorizer` validates every explicit account argument against the tenant's active set, canonicalising provider id quirks (`lib/cloud/account-scope.ts:36-56`); `AccountScopedProvider` restricts reads/previews/writes to the allowed set and refuses to enumerate a full grant (`account-scope.ts:59-92`); a defense-in-depth source-guard fails **closed** if a result's trust tier doesn't match the deployment posture, so synthetic data can never leak into a live surface (`lib/cloud/intelligence.ts:19-23`). `resolveClientScope()` (`lib/markting/ops/agency.ts:29-45`) is a correct server-side membership-graph check that prevents client-A users from targeting client-B's workspace/account — **but it is imported only by tests** (grep: `ops/agency` → `test/phase7-eval.test.ts`, `test/phase7-redteam-fixes.test.ts` only). So the per-client authorization *intent* is coded and tested but not enforced on any live request path. Strong foundation, incomplete wiring.

### 3.6 Approvals & 4-eyes — **3/5**
The approval flow is real: a two-step preview/apply contract re-verified by the PolicyEngine (hash, expiry, policy) on apply (`app/api/approvals/[id]/apply/route.ts`, `app/dashboard/approvals/approval-actions.tsx`). 4-eyes (requester ≠ approver) is enforced in a single policy-engine seam with a **self-approval exception defaulting to off** (`MARKTING_ALLOW_SELF_APPROVAL=false` — `.env.example:108`, `lib/markting/runtime.ts:20-25`), which also covers REST/MCP. Good.
**Gaps:** the enterprise approval policy — multi-approver **quorum**, senior-approver requirement for protected/brand/strategic accounts, no-duplicate-actor (`lib/markting/ops/approval-policy.ts:34-85`) — is imported only by tests and `change-management.ts`, **not by the apply route**. The live apply path is effectively single-approver gated on `owner/admin` (`apply/route.ts:19`). The Approvals page is org-scoped with **no per-client grouping or filter** (`app/dashboard/approvals/page.tsx`), so an agency approver cannot triage "all pending for client X" or "all high-exposure first".

### 3.7 Escalation — **1/5**
No escalation workflow exists in the product. The `requireSenior`/quorum concepts in `approval-policy.ts` gesture at escalation but are unwired. There is no SLA, no reassignment, no "needs senior sign-off" routing in any UI.

### 3.8 Client health — **2/5**
The portfolio attention queue (§3.1) *is* a client-health signal, with per-client reasons and a data-quality center that correctly separates **data problems from performance problems** (`buildDataQuality`, `sections.ts:242-260`; handles stale sync, missing COGS, attribution mismatch, provider schema drift). This separation is unusually honest. But there is no health score history, no trend, no per-client health page, and it covers only 3 demo clients.

### 3.9 Executive summaries — **2/5**
`app/dashboard/executive/page.tsx` composes business performance + profit + forecast + data-quality warnings with honest trust tiers and bilingual (EN/AR) output. It is a credible *single-client* executive brief. It is **not** an agency/portfolio executive summary, is demo-only, and cannot be scheduled or exported.

### 3.10 Reporting — **2/5**
`app/dashboard/reports/page.tsx` renders a flat org-level campaign table plus engine reports. There is **no white-label, no scheduled delivery, no per-client client-facing report, no cross-client rollup, no export to the client's brand**. This is far behind agency-reporting baseline (see §4).

### 3.11 Alerts / notifications — **1/5**
A notification engine exists — `planNotifications`/`applyPlan` with channels `in_app|email|slack|webhook` and dedupe state (`lib/markting/intelligence/notifications.ts`). It is **not wired to any route or surface** (the only `notifications` matches in `app/dashboard` are provider-connection copy, not this engine). There are no alerts in the product, so I cannot be *told* which clients need me — I must go look. For a morning-triage use case this is a core miss.

### 3.12 Audit — **4/5** (a strength)
Append-only audit log, org-scoped, with actor attribution (member / API key / system), tied to approval apply/reject and connection/member/billing events (`app/dashboard/audit/page.tsx`, `lib/cloud/repository.ts` audit inserts around lines 305-367, 784). The platform-admin layer adds a dedicated append-only audit (git log: "platform identity… append-only audit"). This is production-grade and exactly what an agency compliance review wants, modulo per-client scoping/filtering in the UI.

### 3.13 Team workflows & workload prioritization — **1/5**
Team management is basic CRUD: invite by email, set admin/member/viewer, remove (`team-members.tsx`). There is **no per-client team assignment, no pod/market structure, no workload/queue ownership, no "assign client X to buyer Y"**. The attention queue ranks clients but cannot route them to a person. An agency's core operating model (who owns what today) is absent.

### 3.14 Scale to "dozens of clients" — **1/5**
The agency portfolio is 3 static seed clients. `scale-fixtures.ts` can generate up to 10,000 campaign observations — but only for a **perf harness / tests** (`SCALE_TIERS = [100, 1_000, 10_000]`), not for the agency UI. The portfolio view has no pagination, virtualization, or search. There is no evidence the agency surfaces have been exercised at realistic agency scale.

---

## 4. Comparison to leading international agency tooling

| Capability | MARKTING-AI (today) | Market baseline |
|---|---|---|
| Multi-client portfolio at scale (20+ clients) | 3 static demo clients, no search/pagination | Smartly.io / Skai manage 10+ clients, $500k+ combined spend; white-label reports for 20 clients without manual pulls ([adlibrary.com, 2026](https://adlibrary.com/posts/smartly-io-review-2026)) |
| Per-client dashboards | One shared org view | TapClicks gives "one dashboard per client" across 250+ sources ([tapclicks.com, 2025](https://www.tapclicks.com/blog/dashboard-tools)) |
| White-label / client-facing reports | None | AgencyAnalytics & TapClicks: white-label branding, custom domains, scheduled daily/weekly/monthly delivery ([improvado.io, 2026](https://improvado.io/blog/agency-analytics-vs-tapclicks)) |
| Metric alerts | Engine exists, unwired | AgencyAnalytics ships metric alerts + AI summaries ([funnel.io, 2025](https://funnel.io/blog/agencyanalytics-alternatives)) |
| Approval workflows | Real 2-step + 4-eyes; quorum unwired | TapClicks offers approval workflows + mobile approvals ([tapclicks.com, 2025](https://www.tapclicks.com/blog/dashboard-tools)) |
| Enterprise permissions / SSO | 4 UI roles; rich model unwired; no SSO found | Smartly.io: enterprise permissions + SSO ([adlibrary.com, 2026](https://adlibrary.com/posts/smartly-io-review-2026)) |

**Where MARKTING-AI is genuinely ahead of the baseline:** currency honesty (refuses to blend currencies / rejects LLM FX rates — §3.3), trust-tier/source isolation that fails closed (§3.5), the data-problem-vs-performance-problem separation (§3.8), and append-only audit with AI-cannot-approve SoD invariants (§3.6, §3.12). These are differentiated, defensible safety properties that reporting-centric competitors do not emphasise. The problem is that MARKTING-AI has built the *safety* layer of an agency OS before building the *operational* layer (clients, switching, assignment, alerts, client reporting).

---

## 5. Blockers (must-fix before daily agency use)

1. **No real multi-client data path.** Portfolio, switcher and executive view are DEMO-only; live mode is empty. `seed.ts:275-279`, `demo-gatherer.ts:20-29`, `client-switcher.tsx:17`.
2. **No client switching at scale.** Single-membership resolution (`dashboard.ts:38-41`), switcher unwired/`null` in live, no search.
3. **Agency RBAC not wired.** `AGENCY_ADMIN/CLIENT_ADMIN/MEDIA_BUYER/APPROVER/ANALYST` unassignable in UI (`team-members.tsx`, `types.ts:7`); `resolveClientScope` test-only (`ops/agency.ts`).
4. **No alerts in the product.** Notification engine unwired — cannot push "clients needing attention".
5. **No client-facing / scheduled / white-label reporting.** `reports/page.tsx` is a flat org table.
6. **No team assignment / workload routing / escalation.** Cannot say who owns which client today.
7. **Enterprise approval quorum unwired.** Live apply path is single-approver (`apply/route.ts`), quorum/senior policy test-only.

## 6. Strengths (keep and build on)

1. **Deterministic, inspectable client-attention ranking** with transparent reasons (`buildPortfolio`) — the right morning-triage primitive.
2. **Multi-currency discipline** — governed FX only, no blended fake totals, LLM rates rejected (`optimize/fx.ts`).
3. **Account isolation + fail-closed source guard** — robust tenant/account scoping (`account-scope.ts`, `intelligence.ts:19-23`).
4. **Append-only audit with SoD invariants** (AI/service accounts can never approve) — `audit/page.tsx`, `ops/rbac.ts`.
5. **Honest data-quality center** separating data problems from performance problems; bilingual EN/AR throughout.

## 7. Scores summary

| Dimension | Score |
|---|---|
| Cross-client portfolio & prioritization | 2 |
| Client switching | 1 |
| Multi-currency safety | 4 |
| Permissions / RBAC | 2 |
| Account isolation / multi-tenant | 4 |
| Approvals / 4-eyes | 3 |
| Escalation | 1 |
| Client health | 2 |
| Executive summaries | 2 |
| Reporting (client-facing) | 2 |
| Alerts / notifications | 1 |
| Audit | 4 |
| Team workflows | 1 |
| Workload prioritization | 1 |
| Scale to dozens of clients | 1 |

**Can an agency start its morning here and know which 5 clients need attention first?**
Not today. In DEMO it ranks 3 synthetic clients by attention score (promising); in LIVE the surface is empty, there are no alerts, and client switching is absent. The foundation is sound and the safety model is ahead of the market, but the operational agency layer is unbuilt.

**Final adoption verdict: WOULD_PILOT.**
