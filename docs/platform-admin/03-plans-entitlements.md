# 03 — Plans & Entitlements (Discovery)

## Source of truth: HARD-CODED TypeScript (not DB-configurable, not Stripe-driven)
Plans are a hard-coded object `PLANS` in `lib/cloud/plans.ts:23-44`; the only entitlement shape is `PlanDefinition`
(`:11-21`). Five IDs: `['reader','operator','premium','agency','enterprise']` (`:6`). The DB stores only *which* plan
an org is on, as enum `public.cloud_plan` (`20260828120000_cloud_plans_and_account_scope.sql:1`; `premium` added by
`20260828140646...:1`) — the enum carries no attributes. **There is no `plans` table.** A Stripe price ID is
reverse-mapped to a hard-coded plan via env comparison in `planForPrice()` (`billing.ts:39-46`). **Changing any price
or limit requires a code deploy.**

## The plan catalog (verbatim from `plans.ts:23-44`)
| id | name | €/mo | €/yr | maxActiveAccounts | maxMembers | maxRetentionDays | writeAccess | clientWorkspaces |
|---|---|---|---|---|---|---|---|---|
| reader | Free | 0 | 0 | 3 | 1 | 30 | false | false |
| operator | Operator | 19 | 190 | 5 | 2 | 90 | true | false |
| premium | Premium | 79 | 790 | 15 | 5 | 365 | true | false |
| agency | Agency | 149 | 1490 | 40 | 15 | 730 | true | true |
| enterprise | Enterprise | null | null | null (∞) | null (∞) | 3650 | true | true |

## Entitlement fields that EXIST (the complete set — `plans.ts:11-21`)
`maxActiveAccounts`, `maxMembers`, `maxRetentionDays`, `writeAccess` (read-only vs write), `clientWorkspaces` (agency
feature), `monthlyPriceEur`/`annualPriceEur`.

## Entitlement fields that are MISSING entirely (no field exists)
- **AI quota / token / message limits** — none (the AI quota is a single gateway constant, not per-plan — see `05`).
- **Commerce / store limits** — none.
- **API / rate limits per plan** — none (a generic key rate limiter exists in `private.rate_limit_buckets`
  `...cloud_initial_schema.sql:160`, but it is not plan-scoped).
- **Provider limits** (how many of meta/google/…) — none; the provider set is not plan-gated.
- **Trial duration** — not in the plan model; hard-coded global `trial_period_days: 7`
  (`app/dashboard/billing/actions.ts:31`) for all paid checkouts.

## Runtime enforcement (what IS enforced, and where)
`plan-limit.ts` defines only the error type `PlanLimitError` (HTTP **402**, `:17-25`), the kind union
`'active_accounts'|'members'|'retention'` (`:1`), and a parser (`:27-31`). Enforcement is scattered:
- **Ad-account activation** → `repository.ts:748-758` (throws if enabled count ≥ `maxActiveAccounts`); caller
  `app/api/account-access/route.ts:26`.
- **Member invites** → `tenant-admin.ts:33-45` (throws if ≥ `maxMembers`).
- **Retention setting** → `tenant-admin.ts:174-180` (throws if requested days > `maxRetentionDays`).
- **Write access** → MCP write tools denied when `!writeAccess` (`app/mcp/route.ts:20-39`); `tools:write` scope
  stripped in `applyPlanToPrincipal` (`plans.ts:93,103`).
- **Downgrade reconciliation** → on a Stripe plan change, `applySubscription` disables ad accounts beyond the new cap
  (`billing.ts:92-106`). (Note `maxActiveAccounts` is thus enforced in two paths — belt-and-suspenders, duplicated.)

## Can a PLATFORM admin do X today?
| Action | Status | Evidence |
|---|---|---|
| Create a plan | **MISSING** | plans are a code literal (`plans.ts:23-44`); no table/UI/API |
| Edit a plan (limits/features) | **CODE-ONLY (deploy)** | edit `plans.ts` + redeploy |
| Disable / clone a plan | **MISSING** | `PLAN_IDS` is a `const` tuple (`:6`) |
| Set pricing | **CODE-ONLY + manual Stripe** | `*PriceEur` in `plans.ts`; price IDs via env (`lib/env.ts:15-22`) |
| Set limits (members/accounts/retention) | **CODE-ONLY** | `plans.ts:25-42` |
| Set AI quota / token limit | **MISSING** | field doesn't exist (`plans.ts:11-21`) |
| Set store/commerce limit | **MISSING** | not modeled |
| Set feature access (write, clientWorkspaces) | **CODE-ONLY** | booleans `plans.ts:19-20` |
| Set trial duration | **CODE-ONLY, global** | `trial_period_days:7` (`actions.ts:31`), not per-plan |
| Assign a plan manually to an org | **DB-ONLY** | only writers of `organization_subscriptions.plan` are the Stripe webhook (`billing.ts:80-89`) and the default-reader trigger (`20260828120000...:61-77`); needs direct SQL |
| Create enterprise overrides (per-org custom limits) | **MISSING** | enterprise is one fixed row; no per-org override table/column — every enterprise org gets identical limits |

## Implications for a Platform Admin
A "Plans & Entitlements" admin is a **significant build**: it requires migrating the hard-coded catalog to a
DB-backed, versioned `plans`/`entitlements` model (or an overrides table) before any create/edit/clone/price/quota UI
can exist, plus **adding entirely new entitlement dimensions** (AI quota, commerce/store, API, provider, per-plan
trial) that the data model does not currently have. Per-org enterprise overrides are the highest-value, lowest-risk
first step (a single `organization_entitlement_overrides` table read by `getOrganizationEntitlement`). See `13`
GAP-PLN-*, `14`.
