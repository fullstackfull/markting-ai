# Meta — Stage 0 connection verification

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Would verify: secure credential load, provider auth, API version, account discovery, pilot-account presence (id/name/currency/timezone), explicit selection, granted scopes (ads_read/read_insights), no secret in logs, no cross-tenant account active, real (non-fixture) connection health. Blocked: META_ACCESS_TOKEN / META_AD_ACCOUNT_ID absent, MARKTING_LIVE_VERIFY unset.

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
