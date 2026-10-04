# Google — Stage 0 connection

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Deferred until Meta passes all gates. Would verify OAuth/refresh, developer token, customer/MCC discovery + manager relationships, selected customer (currency/timezone), read-only scopes, no auto-activation of child accounts. Blocked: GOOGLE_* credentials absent.

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
