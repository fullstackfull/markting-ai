# C — Live Meta read path

**Honesty preamble.** There are **no live Meta credentials** in this environment. The Meta
adapter's live transport is implemented in code and unit-tested against synthetic / documentation-derived
fixtures, but it has **never been exercised against a real ad account**. Every live read/write is
therefore **`BLOCKED_EXTERNAL`**. Nothing below claims live verification happened.

## What the adapter implements

- **Auth — long-lived token.** Connect exchanges the short-lived code for a short-lived token and then
  calls `fb_exchange_token` to obtain a long-lived token
  (`lib/cloud/provider-oauth.ts:129-139`). There is **no in-adapter refresh** — the registry records
  `refresh: false` for Meta (`lib/connections/registry.ts:135`). Scopes requested: `ads_read`,
  `ads_management` (`provider-oauth.ts:83`).
- **Scope / token discovery via `debug_token`.** `MetaGraphClient.debugToken()` reports `is_valid`,
  `expires_at`, and granted `scopes`, but only when `appId`+`appSecret` are present
  (`platform/packages/meta/src/client.ts:118-131`). This is why permission discovery is `'partial'`,
  not `'full'` — scopes come from token debug, not a clean required-vs-granted comparison
  (`registry.ts:135`).
- **Account discovery.** `me/adaccounts` paged read → canonical `Account[]`, with `account_status`
  mapped through `ACCOUNT_STATUS` (`provider.ts:99-113`, `client.ts:26-35`).
- **Report reads at all four levels.** `INSIGHTS_LEVEL` maps the canonical hierarchy to the
  Graph `level` param: account→`account`, campaign→`campaign`, ad_group→`adset`, ad→`ad`
  (`provider.ts:28-33`), read from `act_<id>/insights` with `paging.next` followed up to the limit
  (`provider.ts:169-199`). Conversions/value come from the `omni_purchase` action
  (`provider.ts:207-209`). Ratio metrics are derived client-side and guarded against divide-by-zero
  (`provider.ts:210-221`).
- **Native ad_group term.** Meta's level is natively **"Ad set"** (ar: مجموعة إعلانية), per the
  registry (`registry.ts:119`).

## What the registry says Meta supports

- **Levels: FULL** — account / campaign / ad_group / ad all `READY` (`registry.ts:108,119`).
- **Dimensions: RAW_ONLY** for `placement`, `device`, `geography`, `age`, `gender` — reachable only via
  the raw `insights(...)` passthrough (`provider.ts:240-259`), **not** fed into the normalized
  `ReportRow` path (`registry.ts:119`, `registry.ts:50-52`).
- **No `audience_segment`** — not a registry dimension at all; absent dimensions default to
  `NOT_SUPPORTED` (`registry.ts:48`, `reportingDimensionSupport` at `registry.ts:214-216`).

## How the live gatherer would normalize it

If credentials existed, `gatherLive` would read account+campaign+ad_group+ad for the current and previous
windows (`lib/cloud/live-gatherer.ts:81-92`), validate each row
(`validateReportRow`, `live-gatherer.ts:25-36`), normalize valid rows as `PLATFORM_REPORTED` trust
(`live-gatherer.ts:112-113`), and feed `analyzeAccount` (`live-gatherer.ts:122-130`). With no connected
provider, `readReportRows` returns `connected:false` with empty rows (`reads.ts:59-60`) and the gatherer
degrades to the honest `NOT_CONNECTED` empty state — never demo content (`live-gatherer.ts:97-99,61-64`).

## Pre-live security items

Before any Meta credential is introduced, the OAuth/token items in `docs/phase-c/14-security-review.md`
apply: the live **OAuth callback exchange** (state/nonce round-trip, code→token) is `BLOCKED_EXTERNAL`
(item 4); live **account discovery** writes are `BLOCKED_EXTERNAL` (item 6); **token
refresh/expiry/replay** behavior is `BLOCKED_EXTERNAL` (item 9). Token storage is AES-256-GCM sealed and
asserted never to render secret material (item 8).

**Status:** Meta live transport is implemented in the adapter but **UNVERIFIED against any real account →
`BLOCKED_EXTERNAL`** (no credentials); levels FULL, breakdown dimensions RAW_ONLY, no `audience_segment`.
