# Google — Stage 1 bounded live read

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Deferred until Meta passes. Would verify account→campaign→ad group→ad with core normalized metrics over a small recent window. Blocked: no credentials.

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
