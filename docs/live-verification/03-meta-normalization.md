# Meta — Stage 2/3 normalization + hierarchy

**Status: BLOCKED_EXTERNAL — CREDENTIALS_REQUIRED.**

Would prove Meta API → adapter → ReportRow → validateReportRow → normalizeReportRows → MetricObservation with correct org/provider/account/level/entity-id/parent/metric/amount/currency/timestamp/provenance(LIVE)/trust-tier/attribution, source guards rejecting FIXTURE/SYNTHETIC/DEMO, correct money exponents (incl. 3-decimal currencies), and a correct account→campaign→ad set→ad hierarchy + live browser walkthrough. Blocked: no credentials.

No live data was fetched or fabricated; Mode B HELD; no provider write invoked. The code path that would execute this stage exists and is CI-green (Phase C.5). See `LIVE-VERIFICATION-EXIT-REPORT.md` for the exact credentials, scopes, env-var names, safest account type, and command needed to unblock, and `00-baseline.md` for the harness evidence.
