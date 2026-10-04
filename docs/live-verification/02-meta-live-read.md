# Meta — Stage 1 bounded live read

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Would fetch a small recent window (yesterday / last 7 days), bounded account→campaign→ad set→ad with core metrics (spend/impressions/clicks/CTR/CPC/CPM/conversions/value/ROAS/reach/frequency) via the live adapter, ≤25 rows. Blocked: no credentials.

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
