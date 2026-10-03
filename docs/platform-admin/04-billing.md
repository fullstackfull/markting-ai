# 04 — Billing / Revenue Operations (Discovery)

## Structural finding
`platform/infra` **does not exist**; there is **no committed Stripe bootstrap/IaC** (`infra/scripts/stripe-setup*`
absent). Stripe products/prices are created manually and wired via env vars (`lib/env.ts:15-22`). The only `stripe`
artifact is the npm dep.

## Stripe integration that EXISTS (tenant-facing, owner-gated)
- Lazy client from `STRIPE_SECRET_KEY` (`billing.ts:19-24`); `billingConfigured()` needs secret + webhook secret
  (`:9-12`).
- **Checkout**: `startSubscription` creates a Checkout Session (`mode:'subscription'`, 7-day trial,
  `allow_promotion_codes:true`, `billing_address_collection:'required'`, org id in `client_reference_id`+metadata) —
  `app/dashboard/billing/actions.ts:13-37`, **owner-only** (`:9,17`).
- **Billing Portal**: `openBillingPortal` (`actions.ts:40-50`), owner-only, needs existing customer id.
- **Webhook**: `app/api/billing/webhook/route.ts` verifies signature via `constructEvent` then `processStripeEvent`.
  **Handled events (complete list, `billing.ts:126-131`):** `customer.subscription.created`, `…updated`,
  `…deleted`. Every other type is recorded + **ignored** (`:119-138`). Idempotency via `private.billing_events`
  (`:120-123,132-136`; table `20260828120000...:51-55`), pruned after 400 days (`:161`).

## Revenue/billing features — presence/absence
| Feature | Status | Evidence |
|---|---|---|
| Trials | **PRESENT** (global 7-day) | `actions.ts:31`; `trialing` entitled (`plans.ts:77`) |
| Coupons / promo codes | **PARTIAL** | `allow_promotion_codes:true` at checkout (`actions.ts:27`); no in-app coupon mgmt |
| Proration / plan change | **DELEGATED to Stripe portal** | `actions.ts:40-50`; in-app upgrade blocked once subscribed (`page.tsx:106`) |
| Invoices | **ABSENT in-app** | no `invoice.*` events handled; no invoice list/view |
| Payment-failure handling / dunning / retries / alerts | **MINIMAL / ABSENT** | `past_due`/`unpaid` statuses mapped (`billing.ts:51-53`), `past_due` still entitled (`plans.ts:77`); **no `invoice.payment_failed` handler, no dunning, no alerts** |
| Refunds / credits | **ABSENT** | no `charge.refunded`/credit-note code; no credits concept |
| Tax / VAT | **ABSENT** | only `billing_address_collection:'required'` (`actions.ts:26`); no Stripe Tax / `automatic_tax` / VAT id |
| SAR / local billing | **ABSENT** | EUR-only (`monthly/annualPriceEur`, UI renders `€` `page.tsx:81-85`) |
| MRR / ARR / churn / expansion / contraction | **ABSENT** | no metrics, aggregation, or revenue views anywhere |
| Failed-payment alerts | **ABSENT** | no emitter |

## Subscription state storage & sync
- Table `public.organization_subscriptions` (`20260828120000...:3-15`): PK `organization_id`; `plan` enum (default
  `reader`), `status` (six values, check `:6-7`), `billing_provider`, unique `provider_customer_id`/
  `provider_subscription_id`, `current_period_end`, `cancel_at_period_end`.
- Auto-provisioned `reader` for every new org via trigger (`:61-77`), backfilled (`:79-81`).
- One-directional **Stripe → DB** sync: `applySubscription` (`billing.ts:57-117`) resolves org by metadata else by
  matching customer/subscription id (`:66-73`), maps price→plan (`planForPrice`), updates the row in a txn (`:78-89`),
  enforces the account cap, writes a `subscription_updated` audit event. Throws if the sub isn't bound to an org
  (`:74`). Read path `getOrganizationEntitlement` (`plans.ts:55-79`) downgrades to `reader` unless
  active/trialing/past_due.

## Tenant billing visibility (today)
`app/dashboard/billing/page.tsx`: current plan + status (`:41-42`), a comparison grid with monthly/annual toggle
(`:59-111`), "Start trial" (owner, if price configured, no existing sub `:99-103`), "Manage billing" portal button
(owner `:46-48`), enterprise mailto (`:119`). **No invoices, no payment history, no next-charge amount.** Non-owners
see "ask owner" (`:105`).

## Platform-operator revenue/ops visibility — NONE
Confirmed absent: no admin route, no revenue dashboard, no MRR/subscriber list, no cross-tenant billing view, no
failed-payment/trial-ending monitor, no Stripe reconciliation UI. The only operator-reachable artifacts are the raw
tables (`organization_subscriptions`, `private.billing_events`) via direct SQL as `adport_backend`, and per-org
`subscription_updated` audit rows (`billing.ts:112`).

## Notable gaps/risks
- Webhook ignores `checkout.session.completed` and all `invoice.*` → **no payment-failure/dunning path at all**.
- `current_period_end` read from first subscription item only (`billing.ts:64`) — multi-item subs unsupported.
- EUR-only, global 7-day trial, no tax/VAT, no per-org/enterprise overrides — all require code changes.
- No committed Stripe setup → product/price provisioning is an undocumented manual step keyed off env (`env.ts:15-22`).

## Implications
A platform Billing/FinOps console (MRR/ARR/churn, subscriber list, failed-payment + trial-ending queues, refunds/
credits, invoice access, tax/multi-currency incl. SAR) is **greenfield**. Several features also need backend
groundwork first: handle `invoice.*`/`checkout.session.completed` webhooks, a credits ledger, and multi-currency/tax
in checkout. See `13` GAP-BIL-*, `14`.
