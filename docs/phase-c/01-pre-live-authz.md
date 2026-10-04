# C0.1 / C0.3 / C0.4 — Pre-live authorization + route-param integrity

## C0.1 — one canonical tenant↔account authorization guard

`lib/cloud/account-authz.ts` is the single boundary:

```
tenantOwnsAccount(tenant, accountId) : boolean
authorizeTenantAccount(tenant, accountId) : void   // notFound() when not owned
```

- **DEMO**: ownership = membership in the synthetic seed portfolio (the only accounts that exist).
- **LIVE**: ownership = a row in `public.organization_ad_accounts` scoped to the org
  (`organization_id = tenant.organizationId AND account_id = :accountId`), i.e. an account the org
  actually discovered through its own connections.

Applied at the top of **every** account-scoped resource route, right after
`requireDashboardTenant()`:

- `/dashboard/accounts/[accountId]`
- `/dashboard/accounts/[accountId]/breakdowns`
- `/dashboard/accounts/[accountId]/campaigns/[campaignId]`
- `…/campaigns/[campaignId]/groups/[groupId]`
- `…/groups/[groupId]/ads/[adId]`

Campaigns / groups / ads / breakdowns are always nested **within** an account, so authorizing the
account is the cross-tenant boundary for the whole drill subtree. The remaining **nested
parent-chain integrity** (a campaign under the wrong account, a group under the wrong campaign, an
ad under the wrong group) is enforced by the section builders, which return `found: false` on any
mismatched tuple (`buildCampaign` / `buildAdGroup` / `buildAd` do nested `.find()` over the real
parent). In DEMO the drill pages turn that `found: false` into `notFound()` (the seed is the whole
universe, so a broken chain is a true 404); the soft "not connected" card is reserved for the
genuine live-without-connections case.

### No cross-tenant existence oracle

A cross-tenant account and an account that exists in no tenant both resolve to `notFound()`
(identical 404) — the response never discloses whether an id exists in another tenant.

Other surfaces that merely **display** an `accountId` column (findings, approvals, reports, audit,
policies) read org-scoped rows and take no account id as a resource path param, so an out-of-tenant
id yields zero rows (same as an unknown id) with no leak — they are intentionally not 404 gated.

The Platform-Admin read plane is separate (`app/(admin)/…`, `adport_platform_admin` role) and is
unaffected by this tenant guard.

## C0.3 — no implicit demo fallback

`seedClientForAccount(accountId)` no longer falls back to the primary demo client for a non-empty
unknown id — it returns `undefined`, and every DEMO loader handles `undefined` with an honest
not-found / empty shape. An unknown account/campaign/group/ad/creative id is therefore a true 404
in DEMO, never silently substituted with the primary demo account.

## C0.4 — dynamic route params are URL-decoded (root cause of the Phase-B divergence)

**Root cause.** This deployment's Next build does **not** URL-decode dynamic route segments. Every
id in this product is a colon-delimited composite (`sandbox:acc:ramadan`,
`…:camp:awareness:ag:lanterns`), and the per-row links build hrefs with `encodeURIComponent`
(`:` → `%3A`). The segment therefore arrived at the page **still percent-encoded**
(`sandbox%3Aacc%3Aramadan`) and never matched the seed/live lookup → the account guard 404'd and
the deeper surfaces fell back. This was diagnosed by reproducing the seeded Supabase + standalone
build locally and instrumenting a live request (observed `accountId = "sandbox%3Aacc%3Aramadan"`).

**Fix.** `lib/cloud/route-params.ts` `decodeParams()` is applied at the top of every dynamic route,
right after `await params`, before the id is used for authorization/lookup or re-encoded into child
links. It decodes exactly once, is a no-op for a value with no `%` (so literal-colon URLs keep
working — the a11y route scan uses those), and falls back to the raw value on a malformed escape.

## Tests

- `test/account-authz.test.ts` — DEMO branch: seeded accounts owned; unknown id denied; unknown →
  `notFound()`.
- `test/account-authz.database.test.ts` — LIVE branch on real Postgres: org A owns its account,
  cannot own org B's account, an id in no tenant is denied identically (no oracle),
  `authorizeTenantAccount` throws the 404 fallback for cross-tenant.
- `test/seed-hierarchy.test.ts` — nested parent-chain integrity + the C0.3 no-fallback assertion.
- `test/route-params.test.ts` — decode of encoded composite ids; no-op for literal/ malformed.
- `e2e/journeys.spec.ts` E2E-14 — follows the **real** per-row links
  Workspace→Account→Campaign→Group→Ad and asserts meaningful content at each level
  (Ramadan Awareness / Lanterns / Lantern Video A), plus the C0.3 unknown-account → 404 regression.

Validated locally against a seeded Supabase + standalone server: full browser suite **36/36**,
full unit+DB suite **1047** passing.
