# Meta — Stage 6 breakdown audit

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Would attempt only registry-permitted dimensions (placement, publisher_platform, device, age, gender, geography, reach, frequency) and classify each LIVE_VERIFIED / LIVE_RAW_ONLY / PERMISSION_BLOCKED / API_LIMITATION / NOT_SUPPORTED / NORMALIZATION_MISSING. Registry today: Meta breakdowns are RAW_ONLY (not normalized). Blocked: no credentials.

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
