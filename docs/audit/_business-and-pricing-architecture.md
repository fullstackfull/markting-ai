# Business & Pricing Architecture — markting-ai

Author: I5 (Business lead). Synthesis of specialist reports I1–I4, independently spot-checked against
code. Every material claim carries a `path:line` citation (relative to repo root) or a command with its
exit code, plus a classification tag (VERIFIED_CODE / VERIFIED_TEST / DOCUMENTED_ONLY / INFERRED /
NOT_VERIFIED). This document does **not** change pricing; it maps the current state and the entitlement/
metering substrate needed for future pricing flexibility.

---

## 1. Current plan & billing state (cited)

### 1.1 Plan catalog
Five plans are hard-coded in a single `PLANS` object; each plan is five dimensions only.
`platform/apps/cloud/lib/cloud/plans.ts:11-44` (VERIFIED_CODE):

| Plan | Monthly | Annual | maxActiveAccounts | maxMembers | maxRetentionDays | writeAccess | clientWorkspaces |
|---|---|---|---|---|---|---|---|
| reader (Free) | €0 | €0 | 3 | 1 | 30 | false | false |
| operator | €19 | €190 | 5 | 2 | 90 | true | false |
| premium | €79 | €790 | 15 | 5 | 365 | true | false |
| agency | €149 | €1490 | 40 | 15 | 730 | true | **true** |
| enterprise | null | null | null | null | 3650 | true | **true** |

`PlanDefinition` has exactly these fields (`plans.ts:11-20`). There is **no** dimension for AI/agent
consumption, managed ad spend, report volume, recommendations, or connector count — the real cost/value
drivers of an "AI media buyer".

### 1.2 Currency & tax
- Prices are **EUR, tax-exclusive**. `infra/scripts/stripe-setup.mjs:17` (`export const CURRENCY = 'eur'`)
  and `:8` (comment: "EUR, tax-exclusive"). VERIFIED_CODE.
- Checkout session has **no** `automatic_tax` and no tax collection:
  `grep -niE "automatic_tax|tax" platform/apps/cloud/app/dashboard/billing/actions.ts` → NONE (exit 0). VERIFIED_CODE.
- No `VAT`, `SAR`, `riyal`, or `zatca` reference anywhere in the cloud app
  (`rg` over `platform/apps/cloud`, exit 0, no hits). VERIFIED_CODE.

### 1.3 Billing plumbing (what works)
- Stripe Checkout (subscription mode, card required, **7-day trial**, promo codes), owner-only:
  `app/dashboard/billing/actions.ts:13-38`. VERIFIED_CODE; `test/billing-actions.test.ts` passes (I3, exit 0). VERIFIED_TEST.
- Billing portal: `actions.ts:40-49`. VERIFIED_CODE.
- Signed webhook `/api/billing/webhook`; subscription create/update/delete mapped in
  `lib/cloud/billing.ts:57-138`; idempotency via `private.billing_events`. VERIFIED_CODE.
- Downgrade reconciliation disables ad accounts beyond `maxActiveAccounts`: `billing.ts:91-106`. VERIFIED_CODE.
- Stripe price/product provisioning: `infra/scripts/stripe-setup.mjs` — 3 products, 6 EUR recurring prices,
  idempotent; `node --test infra/scripts/stripe-setup.test.mjs` exit 0 (I1). VERIFIED_TEST.

### 1.4 Entitlement computation
- `getOrganizationEntitlement(orgId)` is a single-row read of `organization_subscriptions` mapped to the
  hard-coded `PLANS` object; `['active','trialing','past_due']` keep the paid plan, else fall back to
  `reader`. `plans.ts:55-79`. VERIFIED_CODE.
- The principal carries only `{planId, planName, writeAccess}` (`lib/cloud/types.ts`), computed inline at
  each call site. `applyPlanToPrincipal` strips `tools:write` unless `writeAccess && role !== 'viewer'`
  (`plans.ts:98-105`). VERIFIED_CODE.
- There is **no** entitlement-override table, feature-flag table, trial/credit/grandfather mechanism.
  Enterprise limits are hard-coded `null` (`plans.ts:41`), not negotiated per-contract values. VERIFIED_CODE.

### 1.5 Enforcement surface
| Limit | Enforced where | Strength |
|---|---|---|
| active accounts | enable-time `repository.ts:656-664` + webhook downscale `billing.ts:91-106` | EXISTS_AND_STRONG |
| members | invite-time only `tenant-admin.ts:33-42` | EXISTS_BUT_LIMITED (no downgrade reconcile) |
| retention | edit-time `tenant-admin.ts:174-178` + daily `apply_data_retention` pg_cron | EXISTS_BUT_LIMITED |
| writeAccess | plan+role gate at MCP `app/mcp/route.ts:20-40` | EXISTS_AND_STRONG |
| clientWorkspaces | **nowhere** (only a billing bullet) | DOCUMENTED_NOT_IMPLEMENTED |
| AI turns / reports / tokens | **nowhere**; only flat 120 req/min/subject `repository.ts:355` | MISSING |

`PlanLimitError` (402, `plan-limit.ts`) covers only `active_accounts | members | retention` — no usage kind
(`plan-limit.ts:1`). VERIFIED_CODE.

---

## 2. The structural monetization problem

The product is sold as an **AI media buyer**. The dominant variable cost — LLM/engine inference per
Assistant turn and per report run — is **neither metered nor priced**:

- Every Assistant turn (`app/api/assistant/messages/route.ts`) and report run
  (`app/api/reports/engine/route.ts`) forwards to the paid-media engine, which runs an LLM. VERIFIED_CODE (I3-01).
- The only guard is a flat, plan-independent rate limit of 120 req/min per org+user (`repository.ts:355`). VERIFIED_CODE.
- No `usage_events` / `quota` / `meter` / `billMeterEvent` / `tokens_used` anywhere in the cloud app
  (`rg -niE` over `platform/apps/cloud`, exit 0, no billing-metering hits). VERIFIED_CODE (I1-02, I3-01).

Consequence: a €19 Operator and a heavy-automation account cost the same to the operator while consuming
wildly different inference; Free `reader` and `past_due` orgs still reach the engine. There is **no data** to
later bill usage, enforce a quota, or detect abuse. This is the single most important business-architecture
gap and it is a **P1 financial risk**, not a mere feature gap.

---

## 3. Target entitlement & usage-metering architecture (for pricing flexibility)

The goal: make limits **data, not code**, and make consumption **observable and billable**, so pricing can
change without a deploy and so AI/spend/seats can be priced independently.

### 3.1 Usage-metering substrate
```
private.usage_events            -- append-only ledger
  (id, organization_id, user_id, metric, quantity,
   cost_micros, unit, occurred_at, idempotency_key UNIQUE, source_ref)
```
- `metric` ∈ {`assistant_turn`, `report_run`, `recommendation`, `engine_tokens`, `managed_spend_usd`,
  `connector_sync`, `seat_active`}.
- Written **in the same transaction** as the audited action (mirror the `audit_events` write already in
  `billing.ts`), keyed by an idempotency key so retries don't double-count.
- Capture **engine token/cost from the engine response**, not request counts — the engine is the cost
  source (I3-01 recommendation; the engine today returns runs but cloud stores no per-run cost — NOT_VERIFIED
  whether the engine emits token usage, needs engine-side confirmation).
- Rollup `organization_usage_monthly(organization_id, period, metric, quantity, cost_micros)` for fast quota
  checks and dashboard meters.

### 3.2 Entitlement service
Replace the inline `PLANS[planId].<field>` reads at every call site with one resolver:
```
resolveEntitlement(orgId) =
   PLANS[plan]                       -- defaults (code)
   ⊕ entitlement_overrides[orgId]    -- per-org bumps, custom enterprise limits, grandfathering (data)
   ⊕ feature_flags[orgId]            -- gated capabilities incl. clientWorkspaces, SSO, residency (data)
   ⊕ usage_rollup[orgId]             -- remaining quota for metered dimensions
```
- New tables: `entitlement_overrides(organization_id, dimension, value, reason, expires_at)` and
  `feature_flags(organization_id, flag, enabled)`.
- Enterprise limits become **rows**, not `null` in code — a negotiated contract is data.
- All current consumers (`tenant-admin.ts`, `repository.ts`, `mcp/route.ts`, billing downscale) read the
  resolver output. This is the prerequisite for one-off bumps, A/B price tests, promos, trials, and credits
  **without a code change** (today each needs editing `plans.ts` and redeploying — I1-04, VERIFIED_CODE).

### 3.3 Metered Stripe billing
- Add graduated/metered price items (AI runs over quota, managed-spend band) reported via Stripe
  `billMeterEvent` / usage records on period boundaries, reconciled from `usage_events`.
- Today all checkout line items are flat `quantity: 1` (`actions.ts:24`). VERIFIED_CODE.
- Seats should be a **per-seat Stripe line item** reconciled on member add/remove, not a flat price + a soft
  ceiling that is never reclaimed on downgrade (I1-07).

### 3.4 Per-plan quota columns + 402
Add `maxAiTurnsPerMonth`, `maxReportsPerMonth`, `tokenBudget`/`costBudgetMicros` to `PlanDefinition`; enforce
at the assistant/report routes with a 402 `PlanLimitError` (extend `PlanLimitKind` beyond
accounts/members/retention) and surface a usage meter in the UI.

---

## 4. Pricing dimensions a media-buyer SaaS needs (today → target)

| Dimension | Today | Needed |
|---|---|---|
| AI agent runs / turns | unmetered, unpriced | metered quota + overage |
| Report / recommendation volume | unmetered | per-plan quota, metered overage |
| Managed ad spend | not modeled | spend bands (e.g. "up to $Y/mo managed") — standard competitor lever |
| Connected platforms / connectors | not tied to plan | connector-count tier |
| Seats | soft ceiling, invite-time only | per-seat billing, reconciled |
| Accounts | strong (enable + downscale) | keep |
| Retention | edit-time only | reconcile on downgrade |
| Client workspaces | advertised, inert | real sub-org scoping (§5) |

---

## 5. Agency / enterprise packaging gaps

### 5.1 Agency
- **`clientWorkspaces` is advertised and billed but has zero implementation.** Flag true for agency/enterprise
  (`plans.ts:38,42`); rendered as the feature bullet "Separate client workspaces"
  (`app/dashboard/billing/page.tsx:95`, `lib/i18n/messages/billing.ts:53,119`); Agency description promises
  "client workspaces" (`billing.ts:34`). `rg -n clientWorkspaces` finds **no functional reader** (I1-03,
  I2-01). VERIFIED_CODE. Because the billing UI *claims* the capability, this is a representation defect, not
  just a gap.
- **No agency/client hierarchy.** `handle_new_user` creates exactly one org + owner per signup
  (`20260817171039_cloud_initial_schema.sql:220-243`); `organization_ad_accounts` PK is
  `(organization_id, provider, account_id)` with no client/group column (`20260828120000_…:32-45`); no
  org-creation route (grep exit 0, trigger-only). An agency cannot represent "Client A vs Client B" (I2-02).
  VERIFIED_CODE.
- **No org switcher UI**; multi-org users are pinned to the oldest membership by
  `requireDashboardTenant` (`lib/cloud/dashboard.ts`, `order by created_at asc limit 1`) and `shell.tsx:27`
  renders a single static org. `grep` for a switcher → none (exit 0). (I2-03). VERIFIED_CODE.
- **No per-client access scoping.** RLS grants every org member access to every account/finding/audit
  (`20260828120000_…:102-115`); roles are org-global with no account dimension (I2-07). VERIFIED_CODE.
- **No white-label / branding / custom domain / client portal** (`rg` returns only OAuth clients + provider
  SVGs, exit 0) (I2-05). VERIFIED_CODE.
- **"Approvals" are an internal maker-checker gate, not external client sign-off**
  (`app/api/approvals/[id]/apply/route.ts:15-23`) (I2-06). VERIFIED_CODE.

### 5.2 Per-client reporting + shared engine (sharp edge)
The engine client is built from one deployment-wide `MARKTING_ENGINE_URL` + `MARKTING_ENGINE_TOKEN`
(`lib/markting/env.ts:10-12`) with **no org parameter**; `runReport`/`listReports`/`fetchReportFile` carry
**no org/account scope** (`lib/markting/engine-client.ts:127,131,134`); the reports route calls
`listReports()` directly and is not demo-gated (`app/api/reports/engine/route.ts`). VERIFIED_CODE.
If a real engine is pointed at a multi-tenant deployment, every org can list/stream every other org's
report runs — a **cross-tenant leak** (I2-04). Cross-tenant exposure is **INFERRED** (deployment-dependent);
it would be **P0** if confirmed in a shared-engine production deployment. NOT_VERIFIED at runtime (no live
engine).

### 5.3 Enterprise
- **No provisioning path.** `planForPrice` maps only operator/premium/agency (`billing.ts:39-46`); any price
  mapping to enterprise is rejected (`billing.ts:76`); `PLAN_ORDER` excludes enterprise and the CTA is a
  `mailto:` (`billing/page.tsx:15,119`). Granting enterprise requires a manual `update … set plan='enterprise'`
  by a DBA (I4-01). VERIFIED_CODE.
- **Advertised enterprise features are unimplemented.** "Includes SSO, regional hosting, custom retention,
  SLA, and dedicated onboarding" (`i18n/billing.ts:58`, AR `:124`) — only custom retention is real. Auth is
  password + Google/GitHub social only (`app/login/actions.ts:8`); no SAML/OIDC/SCIM (grep exit 0); region
  commented out (`supabase/config.toml:351`); MFA enroll disabled (`config.toml:303,308`); no SLA logic
  (I4-02, I4-06, I4-07). VERIFIED_CODE / DOCUMENTED_ONLY.
- **No audit export; audit UI capped at 150 rows** (`app/dashboard/audit/page.tsx:14`,
  `repository.ts:719`) despite selling 3650-day retention (I4-04). VERIFIED_CODE.
- **No data residency**; privacy policy affirms international processing, contradicting "regional hosting"
  (`platform/website/privacy.html`, `config.toml:351`) (I4-05). VERIFIED_CODE / DOCUMENTED_ONLY.

### 5.4 Branding & legal identity (blocks contracting + leaks leads)
Upstream Adport/Yannick identity is pervasive on revenue + legal surfaces:
- Enterprise CTA → `mailto:yannick@adport.dev?subject=Adport%20Enterprise` (`billing/page.tsx:119`). Every
  enterprise inbound lead goes to the upstream author (I1-05, I4-03). VERIFIED_CODE.
- Support widget: "Yannick from Adport" / "Talk to Yannick" (`i18n/support.ts:10,14`, AR `:62,66`). VERIFIED_CODE.
- Privacy/Terms name "Yannick Westermann, trading as Yannick Westermann Labs" as the operating legal entity
  and sole contact (`platform/website/privacy.html:21,80`, `terms.html:21,45,54`). VERIFIED_CODE.
- No DPA / subprocessor register; `platform/docs/deployment-model.md:55` lists privacy/terms/deletion/
  subprocessor as still-required production gates (I4-08). DOCUMENTED_ONLY.

markting-ai therefore **cannot contract with an enterprise under its own name** today: the published data
controller is a third party, and the highest-intent sales CTA hands the lead away.

---

## 6. Open decisions (VAT, SAR, and the deferred items)

### 6.1 VAT (KSA 15%)
The author has **explicitly deferred** this as an open decision. `docs/billing.md:41` (EN): "prices are EUR
and tax-exclusive as upstream. The right option is Stripe Tax plus `automatic_tax: { enabled: true }` in the
Checkout session (`app/dashboard/billing/actions.ts`, a one-line upstream edit left for your decision)". AR
mirror at `docs/billing.md:21`. DOCUMENTED_ONLY — the code confirms no `automatic_tax` (VERIFIED_CODE).
- **Decision needed:** enable Stripe Tax + `automatic_tax` so KSA VAT (and EU VAT/OSS) is computed and
  invoiced. ZATCA e-invoicing compliance for KSA is a separate, larger decision (no `zatca` code exists —
  VERIFIED_CODE) and would likely require a local invoicing integration, not Stripe alone.

### 6.2 Currency (SAR)
Also deferred. `docs/billing.md:41`: "switching to SAR means changing amounts in `plans.ts` and in the
script together." Today everything is EUR (`stripe-setup.mjs:17`, `plans.ts` prices). DOCUMENTED_ONLY /
VERIFIED_CODE.
- **Decision needed for an Arabic-first product:** present SAR pricing (and possibly multi-currency). Note
  prices live in **two** places that must stay in sync (`plans.ts` display values and `stripe-setup.mjs`
  amounts) — the entitlement-service refactor (§3.2) should make price a single source of truth.
- **Tension:** marketing is Arabic-first / Gulf-targeted, but pricing, tax, legal entity, support, and data
  residency are all EU/German-operator defaults. VAT+SAR are the smallest of a cluster of Gulf-readiness
  decisions (residency §5.3, Arabic legal docs §5.4).

### 6.3 Other open policy decisions surfaced by the team
- **Dunning policy:** `past_due` keeps full entitlement; no `invoice.payment_failed` handler
  (`billing.ts:126-131`, `plans.ts:77`). Decide a grace window + soft-lock (I1-06, I3-05). VERIFIED_CODE.
- **Downgrade grandfathering:** members/retention are not reclaimed on downgrade (I1-07) — decide reclaim vs
  grandfather, explicitly. VERIFIED_CODE.
- **Churn reactivation:** churned orgs are locked out of in-app re-subscribe by the
  `entitlement.providerSubscriptionId` guard (`actions.ts:19`) which is never cleared on
  `customer.subscription.deleted` (I3-02). Decide the reactivation path. VERIFIED_CODE.
- **Trial abuse:** one trial per org, but a user can create unlimited orgs → unlimited 7-day trials
  (per-org subscription + no org-creation cap) (I3). INFERRED.
- **Enterprise API/MCP:** not plan-gated, no per-plan key caps (`repository.ts:292`) (I4-10) — decide whether
  API throughput is an enterprise lever. VERIFIED_CODE.

---

## 7. Summary verdict
The billing *plumbing* (Stripe Checkout/portal/webhook, account-limit enforcement, provisioning script) is
real and tested. The *business architecture* is not ready for the product's own category: there is no usage
metering for the AI cost that defines the product (P1 financial risk), the Agency and Enterprise tiers sell
capabilities the code does not implement (clientWorkspaces, SSO, regional hosting, SLA, client workspaces;
P1/P2), the entity/branding/legal stack is still the upstream vendor's (P1 for enterprise contracting), and
the Gulf-market basics (VAT, SAR, residency, Arabic legal docs) are explicitly deferred open decisions. The
right first move is the **entitlement service + usage ledger** (§3): it unblocks metered/flexible pricing and
is the foundation every other packaging gap depends on.
