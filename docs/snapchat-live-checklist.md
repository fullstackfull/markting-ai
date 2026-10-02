# Snapchat: live verification checklist

The Snapchat provider (`platform/packages/snapchat`) and its cloud wiring ship with adport and are
covered by wire-format tests only. Passing tests is not proof of app approval or of a successful live
read or write. Work through this list, in order, with a **test ad account and a paused campaign**, and
record the outcome and date next to each item. Never run the write steps against a live campaign.

## A. Snap app and OAuth (no adport code involved)
- [ ] Create an OAuth app in Snap Business Manager → Business Details → OAuth Apps.
- [ ] Register the exact redirect URI `${ADPORT_CLOUD_BASE_URL}/api/oauth/snapchat/callback` (hosted) and, if you also use the CLI wizard, `http://127.0.0.1:53684/callback`.
- [ ] Note the scope the app requests: `snapchat-marketing-api` (`SNAPCHAT_SCOPE` in `packages/snapchat/src/client.ts`).
- [ ] Confirm whether the app is in development mode (only members of your Business can authorize) or approved for external advertisers.

## B. Cloud configuration
- [ ] `.env`: `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`, `SNAPCHAT_OAUTH_ENABLED=true`.
- [ ] `ADPORT_PROVIDER_TEST_ORGANIZATION_IDS`: leave **unset** (all organizations) or list your organization id. An empty string denies everyone (`apps/cloud/lib/cloud/provider-rollout.ts`).
- [ ] Restart the cloud container and open Connections: the Snapchat card must no longer say "Awaiting app approval".

## C. Read path (safe)
- [ ] Connections → Snapchat → authorize with a Business member account; expect the consent screen and a redirect back to the account picker.
- [ ] Account picker lists the organization's ad accounts (discovered via `organizations/.../adaccounts`); select the test account only.
- [ ] Accounts page shows the account as active; Reports page returns rows for the last 7 and 30 days, or an explicit "missing breakdown" error rather than an empty success (the provider refuses silent empties).
- [ ] Compare one campaign's spend and swipes with Snap Ads Manager for the same account-local days (Snap reports in the account timezone; adport converts the following midnight to the exclusive end boundary).
- [ ] Confirm "clicks" equal Snap swipes and "conversions" equal attributed purchases (28-day swipe / 1-day view), as documented in `platform/docs/providers/snapchat.md`.
- [ ] Disconnect and reconnect once to verify refresh-token rotation persists (`markting-ai` stores the rotated token through the upstream `onRefreshToken` hook).

## D. Write path (test account, paused campaign only)
- [ ] Policies page: set `max_budget_delta_pct` to a small value (e.g. 10) and add every real account except the test account to protected accounts.
- [ ] Assistant (live engine mode) or REST: preview `snapchat_set_budget` on the paused test campaign; expect a pending operation on Approvals with `serverValidated: false` and the budget delta in micros, and **no** PATCH request in the Snap app's API log.
- [ ] Apply from Approvals; expect exactly one `PATCH /v1/adaccounts/{account}/campaigns/{campaign}` with a single JSON Patch operation on `/daily_budget_micro`. Verify the new budget in Ads Manager and in the audit log (`validated` → `applied`).
- [ ] Repeat for `snapchat_set_campaign_status` PAUSED → ACTIVE → PAUSED on the test campaign only, then leave it paused.
- [ ] Try an over-cap change; expect `POLICY_VIOLATION` and no request to Snap.
- [ ] Let a preview expire (default 15 minutes); expect `PENDING_NOT_FOUND`/`PENDING_EXPIRED` on apply and no request to Snap.

## E. Engine side (analysis)
- [ ] With Pipeboard connected, confirm `snap_ads` tools appear in `discover_tools` and that `paid-media-agent report` still runs (Snap is not a campaign-performance adapter; the report marks it unavailable, which is expected).
- [ ] Decide whether Snap analysis should be added upstream (fixture dataset + normalization in `engine/`); see `docs/TODO.md`.

## F. Record
| Step | Date | Account (masked) | Result | Notes |
| --- | --- | --- | --- | --- |
| | | | | |
