# C — Live Google Ads read path

**Honesty preamble.** There are **no live Google Ads credentials** in this environment. The Google
adapter's live transport is implemented and unit-tested against documentation-derived fixtures
(`test/fixtures/connection-contract-provenance.ts:24` — `DOCUMENTATION_DERIVED`, no live capture), but it
has **never been run against a real customer account**. Every live read/write is **`BLOCKED_EXTERNAL`**.
No live verification happened.

## What the adapter implements

- **Auth — OAuth2 + PKCE, server-side refresh.** The connect flow is OAuth2 with PKCE
  (`registry.ts:134`, `authType: 'oauth2_pkce'`). The REST client holds a cached access token and
  refreshes it server-side via `oauth2.googleapis.com/token` with `grant_type: refresh_token`
  (`platform/packages/google/src/client.ts:56-81`); the token is cached until ~60s before expiry.
- **Manager / login-customer-id aware.** `login-customer-id` is set per operating customer and attached
  as a header; `listAccessibleCustomers` deliberately passes `loginCustomerId: null` so a manager header
  never leaks across tenants (`client.ts:92-122`). Manager hierarchies are walked in `listAccounts` and
  discovered login-customer-ids are recorded per client account (`provider.ts:62-139`).
- **`validate_only` server dry-run.** Every write preview runs `execute(true)`, which sets
  `validateOnly` on the mutate call — a real provider-side dry run that throws on invalid operations
  (`provider.ts:252-262`, `client.ts:148-162`). Registry: `serverDryRun: true` (`registry.ts:134`).
- **Report reads — levels FULL.** `LEVEL_RESOURCE` maps account→`customer`, campaign→`campaign`,
  ad_group→`ad_group`, ad→`ad_group_ad` (`provider.ts:19-24`); GAQL is built per level and read paged
  via `googleAds:search` (`provider.ts:141-182`). All four levels are `READY` (`registry.ts:108,120`).
  Native ad_group term: **"Ad group"** (`registry.ts:120`).

## Honest breakdown status — NOT wired

The registry explicitly marks Google's breakdown dimensions as **`NOT_SUPPORTED`**: `keyword`,
`search_term`, `network`, `device` (`registry.ts:120`). No normalized breakdown is fed into the
`ReportRow` path — these are reachable only by hand-writing a raw `gaqlSearch(...)` query
(`provider.ts:236-250`), which is not the canonical report path. So the drill-down / Breakdown Explorer
surfaces **nothing** for Google beyond the four hierarchy levels. Do not claim segment reporting.

## Product-type nuance (do not overclaim)

Google campaigns span Search, Shopping, Performance Max, Display, and YouTube. The adapter's report path
is **product-type agnostic at read time** — it selects by `advertisingChannelType` only on *create*
(default `SEARCH`, `provider.ts:396`), and reads metrics uniformly across whatever campaigns the account
holds. Honestly:

- **Represented:** any campaign that returns rows from `campaign` / `ad_group` / `ad_group_ad` resources
  for the standard metric set is read. Classic **Search** maps cleanly to the full hierarchy.
- **Not specially represented:** there is **no** product-type-specific normalization. **Shopping** (product
  groups), **Performance Max** (asset groups, no conventional ad groups/keywords), **Display**, and
  **YouTube** have structures the normalized path does not model distinctly — PMax in particular has no
  `ad_group`/keyword equivalent, so those levels will be sparse or empty rather than fabricated. The
  write tools (RSAs, keywords, bidding) are Search-shaped (`provider.ts:293,551-620,665-780`).

## Live gatherer

With credentials, rows would flow adapter → validate → normalize `PLATFORM_REPORTED` → `analyzeAccount`
(`live-gatherer.ts:81-130`). With none connected, `readReportRows` returns `connected:false` and the
gatherer degrades to `NOT_CONNECTED` (`reads.ts:59-60`, `live-gatherer.ts:97-99`). Pre-live OAuth
callback exchange and token refresh/replay remain `BLOCKED_EXTERNAL` per
`docs/phase-c/14-security-review.md` (items 4, 9).

**Status:** Google Ads live transport implemented (OAuth2+PKCE, server-side refresh, `validate_only`
dry-run, manager-aware); levels FULL but **no normalized breakdown wired** (keyword/search_term/network/
device `NOT_SUPPORTED`); product types beyond Search not specially modelled → **`BLOCKED_EXTERNAL`** (no
credentials, unverified).
