# 02 — Overview (READY, read-only)
`/admin` renders cross-tenant KPIs from `lib/platform/reads.ts::platformOverview()` via the SELECT-only
`platformDb()`: users, organizations, active orgs, trials, subscriptions-by-status, connected ad accounts,
connected stores, billable AI requests + est. cost, onboarding completed, pending approvals, active kill switches.
Values that the data model cannot supply render `NOT_AVAILABLE` (never fabricated). A platform-health note states
what is live-evidenced vs NOT_AVAILABLE (no fake GREEN). All counts are bounded aggregate queries.
