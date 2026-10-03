# 07 — Product & UX Assessment

> Author: **G7 (Product lead)**. Source of truth: repository code at HEAD `41b069e`.
> This assessment consolidates the product/UX specialist reports **G1–G6** and the agency
> specialist **I2** (`docs/audit/agents/{G1..G6,I2}.md`), re-verified by re-opening the cited code
> (spot-check log in `docs/audit/agents/G7.md`). Every significant claim carries a `path:line`
> citation and a classification tag: VERIFIED_CODE, VERIFIED_TEST, DOCUMENTED_ONLY, INFERRED, NOT_VERIFIED.
> Severity: P0 (security / data-loss / cross-tenant / unsafe ad execution), P1 (production blocker or serious
> financial risk), P2 (substantial functional/reliability deficiency), P3 (polish/maintainability),
> GAP (missing capability the code does not claim to provide).

---

## 0. Executive summary

The product is positioned (README, in-product copy) as an **Arabic-first "AI media buyer"** for the GCC
market. The adport half — connections, account scoping, plan limits, policy guardrails, the
preview→approve→apply write gate — is real, server-enforced and well tested. The "AI media buyer" half is
**not yet real**: the engine that powers the Assistant and the "AI analysis reports" is pinned to bundled
fixture accounts in *both* demo and live modes (`services/engine-demo/serve_demo.py:386,163`
VERIFIED_CODE), so no persona's accounts are ever analysed by the AI today.

The single most important product truth, verified three independent ways by G1, G2 and I2 and re-confirmed
in the G7 spot-check: **every "AI" surface in the product shows a demo, and the UI calls that demo "your
connected accounts."** Everything in this assessment is downstream of that.

Of the five target personas, exactly one — the **small single-currency advertiser** — can extract partial
value today, and only as a read-only reporting dashboard. The **agency**, **enterprise**, and **50-account
media buyer** personas are blocked by structural gaps (no org hierarchy, no org switcher, one OAuth grant
per provider, flat RBAC, no SSO/SCIM, cross-tenant report list, no bulk ops). The **e-commerce brand**
persona gets platform-attributed ROAS only — and that ROAS tile is structurally `0×` on the overview
(`lib/cloud/reads.ts:54` omits `conversion_value`; VERIFIED_CODE).

Three paid, in-product claims are contradicted by the code and are the highest-priority product risks:
"Separate client workspaces" (Agency €149/mo, live Stripe checkout — unimplemented), "Includes SSO"
(Enterprise — no SAML/OIDC/SCIM), and "Analyses your connected accounts" (Assistant — fixtures only).

---

## 1. Persona-by-persona assessment

Verdict scale: **BLOCKED** (cannot get the advertised value), **PARTIAL** (some real value, major gaps),
**WORKS** (persona's core loop is deliverable today). No persona reaches WORKS.

### 1.1 Small advertiser (1–3 accounts, single currency) — **PARTIAL (read-only)**

| What works | What blocks them | Evidence |
|---|---|---|
| Connect Google/Meta, see a 7-day overview + 30-day campaign table, set budget/approval guardrails. | The AI never looks at their accounts (demo only). On Free they cannot even *preview* a write. On Operator a solo user cannot approve their own change. Onboarding ends by making them wire an MCP client into ChatGPT/Cursor rather than trying the built-in Assistant. | engine pin `serve_demo.py:386,163`; reader `writeAccess:false` `lib/cloud/plans.ts:26`; self-approval block `app/api/approvals/[id]/apply/route.ts:22-24`; onboarding agent step `app/onboarding/onboarding-flow.tsx` + `app/dashboard/agents/agent-setup-guide.tsx` (G1-01, G4-01, G1-07, G1-10) |

The default plan is `reader`/Free (migration default `20260828120000_*.sql:5`), whose entitlement strips
`tools:write` (`lib/cloud/plans.ts:26`). Because the dry-run **preview** is the first half of the same
write tool (`packages/core/src/tools/write.ts`), a Free user cannot preview the thing onboarding presents as
the core safety feature ("Every write requires an exact preview", `lib/i18n/messages/onboarding.ts:15`).
**Verdict: a polished Arabic reporting dashboard with no working AI and no write loop on the plan they land on.**

### 1.2 Agency (many clients) — **BLOCKED**

The agency persona is the product's named target market (Agency plan, `lib/cloud/plans.ts:36-38`) and is
blocked on every agency-defining capability:

- **No client hierarchy.** The data model is one flat `organizations` row per signup
  (`handle_new_user` trigger, `supabase/migrations/20260817171039_*.sql`); `organization_ad_accounts`
  has no client/group column (I2-02, VERIFIED_CODE). There is no "Client A vs Client B".
- **"Separate client workspaces" is sold but does not exist.** The `clientWorkspaces` flag is read only to
  render one billing bullet; `grep` finds no functional consumer (`app/dashboard/billing/page.tsx:95` is
  the sole reader; G7 spot-check CONFIRMED) (I2-01, G6-03, G1-04).
- **No org switcher.** `requireDashboardTenant` pins the user to their *oldest* membership
  (`lib/cloud/dashboard.ts:39-40` `order by membership.created_at asc limit 1`; CONFIRMED). An invited
  teammate who already owns a personal org can never reach the org they were invited to (G1-05, G4-02, I2-03).
- **One OAuth grant per provider** (`unique (organization_id, provider)`, `20260817171039_*.sql`), so client
  accounts in separate Business Managers cannot be connected side by side (G1-06).
- **Cross-tenant report list.** The Reports page calls `engineClient().listReports()` with no org filter
  (`app/api/reports/engine/route.ts:20`; the `organizationId` param only validates session membership, not
  report ownership; CONFIRMED). Today content is fixtures, but the run history is shared and it becomes a
  cross-tenant leak the moment reports carry real data (G1-03, G2-02, I2-04).
- **Org-wide member access, no per-client scoping** (RLS is membership-wide; I2-07); **flat RBAC** (G6-01);
  **no white-label / client portal** (I2-05); **no external client sign-off** (approvals are internal
  maker-checker only, I2-06).

**Verdict: cannot onboard or operate a single client in a segregated way. Do not sell the Agency tier as built.**

### 1.3 Enterprise — **BLOCKED**

- **The Enterprise upgrade path leaves the product**: the CTA is `mailto:yannick@adport.dev?subject=Adport%20Enterprise`
  (`app/dashboard/billing/page.tsx:119`) — a lead routed to the upstream vendor's personal mailbox, in euros,
  under the "Adport" brand (G1-09).
- **"Includes SSO" is advertised; no SAML/OIDC/SCIM exists** — auth is Supabase email/password + Google/GitHub
  social only (`app/login/actions.ts:8`; `lib/i18n/messages/billing.ts:58` claims SSO) (G6-04).
- **MFA is disabled in the committed config** (`supabase/config.toml:303-309`) with no org-level enforcement (G6-08).
- **Audit trail is non-compliant**: capped 150-row UI, no export/SIEM, actor shown as generic
  member/api-key/system, hard-deleted by a retention cron, actor nulled on user delete, no IP/user-agent
  (`app/dashboard/audit/page.tsx`; `apply_data_retention()` + pg_cron; `20260817171039_*.sql:150-168`) (G6-05, G6-06).
- **Offboarding** hard-deletes synchronously, revokes only Google at the IdP, ignores the designed
  `deletion_requests` lifecycle, and offers no DSAR export (`app/api/deletion/route.ts:13-24`) (G6-10).

**Verdict: fails standard enterprise procurement (identity, audit, change-control) and the only upgrade
path is an email to a third party.**

### 1.4 E-commerce brand — **PARTIAL (read-only, platform-attributed)**

- **No store revenue / catalog / feed / product-level view.** `docs/TODO.md §3` concedes Salla/Zid are
  "nothing exists yet"; ROAS is platform-reported only (G1-16). A brand cannot see MER, CAC, LTV or profit
  (cross-ref deliverable 09, Media-Buyer Capability Matrix: all e-commerce rows PARTIAL/MISSING).
- **The headline ROAS tile is structurally `0×`.** `lib/cloud/reads.ts:54` requests
  `['spend','impressions','clicks','conversions','roas']` — not `conversion_value` — while
  `live-data.tsx:39,41` computes blended ROAS as `sum(conversion_value ?? 0) / spend`. With
  `conversion_value` never projected by the providers, the overview's one blended efficiency number is
  always zero while the per-row ROAS column shows real values (CONFIRMED) (G2-03).
- Proposals are limited to `update_campaign_budget` / `update_campaign_status` (`lib/markting/translate.ts`);
  no creative, bidding, audience or feed actions (G1-16, G5 Creative Intelligence MISSING).

**Verdict: a read-only cross-channel reporter with a broken headline ROAS and no commerce awareness.**

### 1.5 Media buyer with 50 accounts — **BLOCKED**

- **Agency plan caps 40 active accounts** (`plans.ts:37`); Enterprise is unlimited but unreachable in-product
  (mailto CTA) (G1, I2-92).
- **No bulk operations**: enable/disable is one request + full refresh per account
  (`account-access-manager.tsx:36-50`); approvals are one-by-one; no multi-select anywhere except the OAuth
  account picker (G1-15, G2-09).
- **No alerts / monitoring** between visits: connection errors surface only when someone opens Connections;
  no pacing, anomaly, disapproval or token-expiry alerts; the only pg_cron jobs are retention and selection
  expiry (G1-14, G5 Alerts MISSING).
- **No saved views, filters, date ranges, or export** on any data screen; windows are baked into the route
  (Overview `last_7_days`, Reports `last_30_days`) (G2-09, G5-04).
- **Mixed-currency KPIs are meaningless**: totals sum SAR+AED+USD with no grouping even though the engine's
  `summarizeReport` already produces per-currency, spend-weighted ROAS that the dashboard discards
  (`live-data.tsx:34-41`; `reads.ts:58` drops `summary`; `packages/core/src/report-summary.ts`) (G1-08, G2-04).

**Verdict: cannot operate at scale; nothing watches the accounts between logins.**

### Persona scorecard

| Persona | Verdict | Primary blockers (finding IDs) |
|---|---|---|
| Small advertiser | PARTIAL (read-only) | C01 (AI=demo), C12 (Free can't preview), C07 (self-approval) |
| Agency | BLOCKED | C04 (client workspaces sold, absent), C05 (no switcher), C06 (1 grant/provider), C02 (cross-tenant reports), C13 (flat RBAC/per-client access) |
| Enterprise | BLOCKED | C15 (SSO/SCIM/MFA), C16 (audit non-compliant), C09 (mailto to third party), C02 |
| E-commerce brand | PARTIAL (read-only) | C01, C08 (ROAS 0×/mixed currency), C17 (no commerce data) |
| 50-account media buyer | BLOCKED | C10 (no alerts), C11 (no bulk/views), C08, C05, C06 |

---

## 2. Confusing & broken flows (what a user actually hits)

1. **"Analyses your connected accounts" → analyses fixtures.** With demo mode off and engine mode live, the
   Assistant presents fixture analysis of `demo-google`/`demo-meta`/`demo-reddit` as the user's own data; the
   demo banner only appears when `MARKTING_DEMO_MODE=true` (`assistant/page.tsx`), so live-mode users get no
   provenance warning (G1-01, G2-01). **P1.**
2. **Live-mode proposals require hand-written SQL.** A proposal maps to a real account only if a
   `markting_account_aliases` row exists; `upsertAlias` has no caller outside tests and there is no UI to
   create aliases, so every live proposal returns "could not be mapped to an account"
   (`lib/markting/translate.ts`; `lib/markting/repository.ts:52`; seed does raw SQL
   `infra/seed/seed-demo.mjs`) (G1-02). **P1.**
3. **Free user completes onboarding, then hits a 403 on the first write.** Onboarding never discloses that
   Free is read-only or that writes need Operator+; the REST path returns a raw
   `API key lacks required scope: tools:write` (`lib/cloud/auth.ts`), only MCP degrades gracefully with a
   `PLAN_LIMIT` message (G4-01). **P2.**
4. **Invited teammate lands in the wrong (empty) org and cannot switch.** Oldest-membership resolver
   (`dashboard.ts:39-40`) + no switcher strands every invitee who already owns an org (G4-02, I2-03). **P2.**
5. **Approver sees the least information.** The Approvals row shows only `preview.summary` + the pending id
   (`approvals/page.tsx:30`, CONFIRMED); `changes`, `coercions`, `budgetDeltas`, `serverValidated`, engine
   `before/after`, `risk`, `measurement_plan`, `reversal_plan` all exist in the loaded data but are never
   rendered. Reject posts no reason though the API accepts one; Apply is shown to the requester who will get a
   403; expiry is a bare UTC timestamp on a 15-minute TTL (G1-13, G2-05, G2-06). **P2.**
6. **"Remove member" is broken from the dashboard.** The client sends a JSON body with no query string
   (`team-members.tsx:27` `fetch('/api/members',{method:'DELETE',body:JSON.stringify(...)})`) while the server
   `DELETE` reads `organization_id`/`user_id` from the URL search params
   (`app/api/members/route.ts:50-51`); the zod `uuid()` parse of a `null` search param throws (CONFIRMED;
   also flagged in `docs/TODO.md §7`). **P2.**
7. **Account "add" vs "enable" is two surfaces.** Connecting from onboarding bounces to `/account-selection`
   (outside the stepper, no progress bar) to *pick* accounts, then back to the onboarding step to separately
   *enable* each for agent access, subject to the Free cap of 3 (G4-04). **P3.**
8. **Provider cards dead-end on "Unavailable."** One opaque string conflates not-configured / rollout-gated /
   suppressed, with no Connect button and no reason; on a deployment with provider env unset, every card is
   "Unavailable" and a new user can connect nothing (`connections.ts:20,57`;
   `provider-connections.tsx:76,89`) (G4-03). **P3.**
9. **Findings is a permanently empty primary nav module.** No code path writes a finding row — both runtime
   builders only *construct* `PostgresFindingsStore`; the sole `.save()`/`insert into public.findings`
   (`repository.ts:477`) has no non-test caller (CONFIRMED). The page sits in one of eight primary nav slots
   showing "no findings" forever, indistinguishable from "healthy" (G5-01). **P2.**
10. **Two near-duplicate tables.** Overview "Campaign activity" (7d) and Reports "Campaigns" (30d) are the
    same table with different windows and one differing column; the user must learn "Overview=7d, Reports=30d"
    instead of choosing a window (G5-04). **P3.**
11. **Assistant conversations vanish on reload.** `messages`/`threadId` live only in React state; the
    `markting_threads` table and `listThreads` exist but nothing in the UI calls them; the composer blocks for
    up to minutes with no streaming; replies render as raw `<pre>` with Markdown markers showing (G2-07). **P2.**

---

## 3. Missing: dashboards, alerts, bulk ops, saved views, hierarchy

| Capability | Status | Evidence / note |
|---|---|---|
| Daily morning brief (top movers, pacing risk, pending approvals, 1–3 recommended actions) | MISSING | `grep morning/brief` → 0 platform hits; engine has cadence machinery (`engine/.../reports/cadence.py`) but weekly/monthly only (G5) |
| Account Health rollup (per-account status, pacing vs budget, ΔROAS/ΔCPA) | MISSING | KPIs exist only on Overview, client-computed, 7-day fixed, no deltas, no per-account health (G5-03) |
| Alerts / anomaly notifications (spend spike, ROAS drop, disapprovals, token expiry, pending-approval reminders) | MISSING | no scheduler, no alert model; all 9 `alert` hits are `role="alert"` error callouts (G1-14, G5) |
| Bulk operations (multi-select enable/disable, bulk approve, bulk account add) | MISSING | one request + full refresh per account toggle; one-by-one approvals (`account-access-manager.tsx:36-50`) (G1-15, G2-09) |
| Saved views / filters / search | MISSING | Findings ignores the store's `{status,provider}` filters; Audit/Approvals unfiltered; no saved views anywhere (G1-15, G2-08) |
| Date-range picker + period-over-period compare | MISSING in UI | windows baked into routes; core supports `today/yesterday/this_month`/custom + `compare_periods` (G2-09, G5-03) |
| Hierarchy: entity drill-down (account → campaign → ad group → ad) | MISSING | reads fixed at `level:'campaign'`; no per-campaign page (G2-09) |
| CSV / Sheets / scheduled export | MISSING | no export on any screen; no audit export for compliance (G1-15, G6-05) |
| Currency-aware KPIs | MISSING in UI (exists in core) | `summarizeReport` per-currency totals discarded (`reads.ts:58`) (G1-08, G2-04) |
| Decision history + outcome tracking (applied change → measured effect) | MISSING | audit is event-centric; no proposal→applied→outcome chain; engine "outcome" is run plumbing (G5-05) |
| Org hierarchy / teams / client workspaces / consolidated billing | MISSING | flat org schema; `clientWorkspaces` flag dead (G6-09, I2-01/02) |
| Notes / annotations / collaboration | MISSING | only machine-written `note` events (G2-10) |

---

## 4. Arabic terminology & RTL corrections (a list, NOT applied)

Source: G3 (Arabic RTL UX expert), spot-checked at HEAD. Terminology-inconsistency counts re-confirmed:
المزوّد 31 vs المنصة 2 (provider), المنظمة 10 vs المؤسسة 4 (organization), الخطة 8 vs الباقة 2 (plan).
These are proposals for a product owner / native reviewer; **do not apply blindly** — pin one glossary first.

### 4.1 Glossary (pick one term per concept, then lint for the rejected variants)

| Concept | Current variants (file) | Recommended | Why |
|---|---|---|---|
| Plan / subscription | الباقة (`nav.ts`) vs الخطة (`billing.ts`,`misc.ts`,`support.ts`) | **الباقة** | Saudi telecom/SaaS convention; الخطة reads as "plan of action" |
| Organization | المؤسسة (`approvals.ts`,`audit.ts`,`overview.ts`) vs المنظمة ×10 (`team.ts`) | **المؤسسة** (or المنشأة) | المنظمة connotes NGOs in KSA |
| Provider / platform | المزوّد ×31 vs المنصة (`connections.ts`,`onboarding.ts`) | **المنصة الإعلانية** (short المنصة) | Buyers say "المنصات" (Snap, TikTok, Google), never "المزوّد" |
| Findings | الملاحظات (`nav.ts:37`) vs نتائج التدقيق (`findings.ts`) | **نتائج التدقيق** | الملاحظات collides with "feedback" in support |
| Agent (AI/MCP client) | الوكيل/الوكلاء | **الوكيل الذكي** first use, then الوكيل | bare وكيل = distributor/agency in KSA |
| Working… (during disconnect) | جارٍ التنفيذ… (`connections.ts:70`) | **جارٍ المعالجة…** | "تنفيذ" wrongly implies a write |
| Impressions | الظهور | **مرات الظهور** | standard Meta/Snap Arabic UI term |
| Coercions | تعديلات إلزامية (`assistant.ts`) | **تعديلات تلقائية على القيم** | they are value normalisations, not mandatory |
| Hash | تجزئة (`agents.ts`) | **بصمة (hash)** | comprehension |
| Retired workspace | مُتقاعدة (`support.ts:105`) | **تم إيقاف مساحة العمل** | calque |
| API key | API key / مفتاح API | **مفتاح API** (+ "هذا المفتاح") | mixed-script after demonstratives |
| Quotation marks | " " and « » | **« »** | Arabic convention; already the majority |
| Revoked/cancelled | مُلغى (`common.ts`) vs ملغى (`billing.ts`) | **مُلغى** | one spelling |

### 4.2 Grammar / register corrections (file:line → fix)

- `reports.ts:55` `'{rows} صفًا'` — only correct for 11–99. Make it a plural key (`rows_zero…rows_other`)
  like `overview.operations`.
- `assistant.ts` CPA prompt `'أي حملة ارتفعت فيها CPA أكثر؟'` → "في أي حملة ارتفعت تكلفة الاكتساب (CPA) أكثر؟".
- `approvals.ts` approvals intro — the "exact second call / hash-bound to its arguments" calque reads as
  machine translation; rewrite to plain Gulf MSA (see G3-08 for a full suggested sentence).
- `accounts.ts` `'{active} / {max} نشط'` → "{active} من {max} نشطة" (adjective agreement with حسابات).
- `overview.ts` `'{impressions} ظهور'` → "{impressions} مرة ظهور".
- `audit.ts:59` `'مرفوض'` → "تم الرفض" (parallel with تم التحقق / تم التنفيذ).
- `billing.ts` `'الأفضل قيمة'` → "الأفضل قيمةً" / "الأكثر قيمة".
- `support.ts` first-person founder voice ("بريدي", "تحدّث مع Yannick") → the product's support identity.

### 4.3 RTL / typography / formatting (CSS & layout — not copy)

- Arabic labels fall through a **monospace** stack (no Arabic glyphs) with `text-transform:uppercase` and
  positive `letter-spacing` on every table header, metric label, form label and kicker
  (`globals.css` `.metric-label`,`th`,`.nav-label`,…). Scope mono to `[dir="ltr"]`/numeric spans; set labels
  to `var(--font-sans)`, `letter-spacing:0`, `text-transform:none` under `html[lang="ar"]` (G3-02). **P3.**
- 25 negative `letter-spacing` heading declarations apply to Arabic (pull joins/marks together) — reset under
  `html[lang="ar"]` (G3-03). **P3.**
- Physical-direction leftovers cause a **visible billing checkmark overlap** in RTL
  (`.plan-features li` physical left padding vs `::before` at inline-start) plus a `select` chevron on the
  wrong side (`globals.css:221,222,319,355,380`) — the PHASE2 claim "all 32 converted to logical" is false
  (G3-04). **P3.**
- `unicode-bidi:plaintext` on `.cell-sub`/`.workspace-name` reorders Arabic fragments when the first token is
  a Latin id and truncates org names from the wrong side; wrap Latin tokens in `<bdi>`/`dir="ltr"` and put the
  Arabic label first in mixed template strings (G3-05). **P3.**
- **Timestamps are UTC with a hard-coded " UTC" suffix**; approval expiry therefore shows 14:00 UTC for a
  change that actually expires 17:00 Riyadh, and two components format dates differently (one bypasses
  `formatDate` with `toLocaleString`, causing a hydration mismatch). Format in the org timezone (default
  `Asia/Riyadh` for `ar`) through one path (`components/ui.tsx:71-74`; `assistant-chat.tsx`,
  `engine-reports.tsx`) (G3-06). **P2** (misread approval windows).
- Browser **tab titles / meta are English on every page** (static `metadata` can't read the locale cookie);
  move to `generateMetadata()` (G3-01). **P3.**
- **EUR pricing, no SAR/VAT** (`plans.ts` `monthlyPriceEur`; `formatMoney(..., 'EUR')`); add SAR price points,
  `automatic_tax`, `locale:'ar'` on Stripe Checkout (G3-10, G4-05). **GAP/market-fit.**
- **Engine prose, demo replies and HTML/PDF reports are English** inside the Arabic UI; no `locale` is
  forwarded to the engine and `engine/instructions.md` has no language directive; pass locale + an Arabic
  system-prompt clause and fork `report.html.j2` with `lang="ar" dir="rtl"` (G3-09). **P3 (GAP where documented).**
- **Upstream brand leakage**: "Adport"/"adport.dev"/"Yannick" embedded in ~40 Arabic strings and the Enterprise
  mailto (G3-13, G1-09, G4-06). **P3 (P2 for the third-party lead routing).**

Positive: Arabic is the default locale with RTL document direction, 6-category plural handling, and
Latin-digit numerals (a correct call for media buyers); `test/i18n.test.ts` passes 8/8 (G3; VERIFIED_TEST).

---

## 5. Proposed IA — "AI Media Buyer Workbench" mapped to existing code

Today's IA frames the product as a passive reporting dashboard: Overview is the hub, the Assistant (the only
surface that turns intent into action) is one of eight peer sidebar links with no shell presence (G5-02).
A world-class AI-media-buyer IA puts the **work loop** first and demotes workspace configuration to settings.

### 5.1 Target navigation

**Primary (the loop):**
1. **Ask AI** — persistent composer/command bar in the shell, not a tab. *Exists, limited:*
   `app/dashboard/assistant/{page,assistant-chat}.tsx` + `lib/markting/assistant.ts:28` (chat → proposal →
   Approvals bridge). Needs: thread history (`markting_threads` + `listThreads` already exist, unused),
   streaming, Markdown, a global composer, and — critically — a **tenant data path** so it analyses real
   accounts (C01).
2. **Morning Brief (home)** — top movers, pacing risks, pending approvals, 1–3 recommended actions.
   *Missing.* Build on engine cadence machinery (`engine/.../reports/cadence.py`) + the normalized rows adport
   already reads (`lib/cloud/reads.ts:48`).
3. **Account Health** — per-account status, pacing vs budget, ΔROAS/ΔCPA period-over-period, one health
   signal/account. *Partial:* Overview KPI row + engine `summarize_window`; needs server-side KPI compute
   (for parity with engine reports) and `compare_periods` deltas (G5-03).
4. **Opportunities / Recommendations** — engine-produced, ranked, each a one-click proposal into the existing
   Approvals bridge. *Partial:* recommendations are trapped as free text inside engine report HTML
   (`engine/.../domain/reports.py:51`); surface them as an actionable queue.
5. **Approvals** — *Exists and strong mechanism* (`approvals/page.tsx` + `approval-actions.tsx` +
   `app/api/approvals/[id]/{apply,reject}`); needs the full inline preview, reject-reason, hide-apply-for-
   requester, relative expiry, and per-org self-approval policy (C07).
6. **Decisions & Outcomes** — decision-centric ledger joining `audit` `applied` events to the originating
   proposal, then re-reading the affected entity post-change via `compare_periods`. *Missing* (G5-05).

**Analyze:**
- **Campaign Explorer** — one entity table with a window selector + drill-down (account→campaign→ad group→ad),
  replacing the Overview/Reports duplication (G5-04); core already supports all levels and ranges.
- **Reports** — reserve for the engine's deterministic weekly/monthly deliverables (keep
  `reports/engine-reports.tsx`), **scoped per org/client** (C02).
- **Creative Intelligence** — the `CREATIVE` entity level is already read/normalized by the engine
  (`engine/.../tools/reads.py`); add fatigue / top-bottom assets. *Missing surface.*
- **Alerts** — user-set thresholds (spend spike, ROAS drop, disapprovals, token expiry) feeding a
  notifications feed, distinct from the `role="alert"` error reuse. *Missing.*

**Settings (utility, demote from primary):** Connections · Accounts · Agent access · Policies · Team · Plan
(all EXISTS today as `nav.tsx` utility/primary items). Move **Findings** here (or wire a producer) until it
is populated — it must not hold a primary slot while permanently empty (C09).

### 5.2 Agency overlay (unlocks personas 2 & 5)

On top of the loop above, the agency/enterprise personas additionally need a **client dimension**: a
first-class `clients` grouping with accounts assigned to clients; an **org/client switcher** (thread a chosen
id through the `requestedOrganizationId` plumbing that already exists in `sessionPrincipal`/`resolveMembership`
but has no UI); per-client RLS scoping of every read; per-client report cadence; and white-label branding on
client-facing report views. None of this exists today (I2 §"What a world-class system would need").

### 5.3 What the reorg buys each persona

| Persona | Primary IA lever |
|---|---|
| Small advertiser | Ask AI as the hub + Morning Brief → activation without the MCP-client detour |
| Agency | Client dimension + org switcher + per-client reports/scoping |
| Enterprise | Decisions & Outcomes ledger + compliant Audit + SSO (identity, not IA) |
| E-commerce brand | Account Health with real ROAS (conversion_value) + commerce connectors |
| 50-account buyer | Account Health rollup + Alerts + bulk ops in Campaign Explorer |

---

## 6. Disagreements — in-product/doc claims the code contradicts

| Claim | Where | Code reality | Class |
|---|---|---|---|
| "Analyses connected accounts (spend, conversions, CPA, ROAS)" | `README.md`; `lib/i18n/messages/assistant.ts:5` | Engine pinned to `sample` in both modes (`serve_demo.py:386,163`); tenant accounts never read | VERIFIED_CODE |
| Agency/Enterprise: "Separate client workspaces" | `billing/page.tsx:95`; `billing.ts`; `plans.ts:38,42` | No implementation; flag read only to render a bullet | VERIFIED_CODE |
| Enterprise: "Includes SSO … SLA" | `billing.ts:58` | No SAML/OIDC/SCIM; no approval SLA/escalation | VERIFIED_CODE |
| Overview ROAS footer "Conversion value ÷ spend" | `overview.ts` | `conversion_value` never requested → always 0× | VERIFIED_CODE |
| "Longer audit history" retention upsell | `support.ts` | Retention cron **hard-deletes** audit events; no archival | VERIFIED_CODE |
| "All 32 physical direction declarations converted to logical" | `PHASE2-REPORT.md:13`; `UPSTREAM.md` | 5 physical shorthands + a `background-position:right` remain; visible billing overlap | VERIFIED_CODE+RUNTIME (G3) |
| "The Approvals page is display-only / no apply button" | `ARCHITECTURE.md`; `PHASE0-REPORT.md` | Apply/reject exist (`approval-actions.tsx`); docs stale | VERIFIED_CODE |
| Provider cards say "…approval" | `snapchat-live-checklist.md:17`; `PHASE0-REPORT.md` | Only "Unavailable"/"غير متاح" exists | VERIFIED_CODE |
| "Arabic by default" | `README.md`; `PHASE2-REPORT.md` | `Accept-Language` wins over the default on first visit (`server.ts:89-91`) | VERIFIED_CODE |
| `docs/TODO.md §7`: members DELETE body/query mismatch | `docs/TODO.md` | Confirmed still broken (`members/route.ts:50-51` vs `team-members.tsx:27`) | VERIFIED_CODE |

---

## 7. Confidence & what was NOT verified

**Confidence: 0.82.** All consolidated findings are code-level facts re-confirmed in the G7 spot-check
(`docs/audit/agents/G7.md`). The specialist evidence held in every case I re-opened; line numbers drifted
across commits (reports written at `f80877c`/`11784fd`; HEAD `41b069e`) but substance was stable.

Not verified (carried from the specialists):
- **No runtime rendering.** No browser, database or engine was started by G7; UI/layout/RTL claims are from
  TSX + CSS reads and the earlier workflow Playwright screenshots cited by G3. NOT_VERIFIED at HEAD.
- **Live LLM behaviour** (`MARKTING_ENGINE_MODE=live`): the fixture-data *pin* is VERIFIED_CODE; whether a
  real model answers Arabic questions in Arabic is NOT_VERIFIED (no model key).
- **Cross-tenant report exposure** (C02) is VERIFIED_CODE for the unscoped `listReports()` call; the *leak*
  is INFERRED/deployment-dependent and would be P0 only against a shared-engine, real-data production.
- **Database integration tests** (`*.database.test.ts`) were not run (no Postgres).
- **Arabic copy quality** for a native Saudi media buyer — the glossary needs a native reviewer
  (`docs/TODO.md` already lists this).
