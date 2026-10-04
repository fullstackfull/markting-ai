# Live verification — exit report

## Result: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED

The first real credential-backed live verification (Meta first, then Google) **could not be performed**:
this environment has no Meta/Google credentials and the enable flag is unset. This was verified by
presence-check (names only) and by running the read-only harness, which returned
`DISABLED / BLOCKED_EXTERNAL` for both providers with zero network I/O. **No live data was fetched or
fabricated. Mode B remains HELD; no provider write was invoked.**

Every stage (connect → verify → read → normalize → analyze → compare → report) remains BLOCKED on
credentials. The architecture to run them exists and is CI-green (Phase C.5); only the live inputs are
missing.

## What is required to unblock (exactly)

### Meta (run first)
- **Credential type:** a Meta Marketing API **access token** (a long-lived System User token is safest)
  for the pilot ad account, plus the ad account id.
- **Permissions/scopes (read-only):** `ads_read` (and `read_insights`); the token's user must have at
  least Analyst access to the account. **Do not** grant `ads_management` — no write scope is needed or
  wanted (Mode B is HELD).
- **Environment variable names (values set in the environment's settings, never in chat/commits):**
  `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` (format `act_<id>`), plus `MARKTING_LIVE_VERIFY=1` to enable
  the harness.
- **Safest account type:** a low-spend / sandbox / throwaway **test** ad account you own — never a
  production client account for the first run.
- **Exact command:**
  `MARKTING_LIVE_VERIFY=1 META_ACCESS_TOKEN=… META_AD_ACCOUNT_ID=act_… node scripts/live-verify.mjs --provider meta`

### Google Ads (only after Meta passes all gates)
- **Credential type:** OAuth2 **access/refresh token** for a Google Ads account, a **developer token**,
  and the customer id (login-customer-id if under a manager/MCC).
- **Permissions/scopes (read-only):** `https://www.googleapis.com/auth/adwords` with **read-only** account
  access (Google Ads "Read only" user); developer token at least Test-account access for a test customer.
- **Environment variable names:** `GOOGLE_ACCESS_TOKEN`, `GOOGLE_DEVELOPER_TOKEN`, `GOOGLE_CUSTOMER_ID`
  (+ `MARKTING_LIVE_VERIFY=1`).
- **Safest account type:** a Google Ads **test account** (or a low-spend account) under your own MCC.
- **Exact command:**
  `MARKTING_LIVE_VERIFY=1 GOOGLE_ACCESS_TOKEN=… GOOGLE_DEVELOPER_TOKEN=… GOOGLE_CUSTOMER_ID=… node scripts/live-verify.mjs --provider google`

### Where to put the credentials (this cloud environment)
Set them as environment variables / API credentials in the **cloud environment's settings** (the cloud
environment menu in the session title bar → Edit → API credentials or environment variables). A new
session picks them up. **Never paste a token into the chat, a commit, a doc, a fixture, a log, or the
browser.** Redaction + sanitizer (`lib/markting/ops/sanitize.ts`) and secret-free logging are already in
place and were confirmed active before any credential use was attempted.

## Safety confirmations for the eventual run
- The harness is READ-ONLY (no budget/pause/resume/create/modify/targeting/bids/negative-keywords), caps
  the dataset (≤25 rows), contacts no provider on the disabled path, and performs the documented 12-step
  read-only plan only when explicitly enabled against a throwaway test account.
- Use ONE designated pilot org and only explicitly-selected test accounts; do not auto-activate every
  discovered account. The ownership chain (user/org → connection → credential → discovered account →
  activated account) is verified before any read.
- Live AI model activation is a separate, later approval — NOT part of this verification.

## Recommendation
Supply a Meta test-account read-only token (`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`) + set
`MARKTING_LIVE_VERIFY=1` in the environment settings, then re-run this mission Meta-first. Google follows
only after Meta clears its exit gate.
