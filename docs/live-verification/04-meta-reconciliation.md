# Meta — Stage 8 reconciliation

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Would compare several entities' spend/impressions/clicks/conversions/CPA/ROAS against Meta's own reported values and classify MATCH / WITHIN_EXPECTED_LAG / ATTRIBUTION_DIFFERENCE / ROUNDING_DIFFERENCE / SCHEMA_DIFFERENCE / UNEXPLAINED_MISMATCH. Blocked: no credentials — no numbers to reconcile (none fabricated).

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
