# 09 — Support & Customer Success (Discovery)

## What exists (tenant-facing only)
- **Feedback table** `20260828140646_onboarding_feedback_and_premium_plan.sql:14-36`: `status`
  (new/in_progress/resolved), `notification_status`, org + creator FKs. RLS `feedback_select_creator` → a user sees
  **only their own** rows (`:88-90`); insert requires membership (`:92-100`).
- **Lib** `lib/cloud/support.ts`: `createFeedbackMessage` (5-per-10-min rate limit `:25-29`),
  `setFeedbackNotification` (`:38-47`), `notifySupportMessage` emails via Resend to `SUPPORT_NOTIFICATION_EMAIL`
  (`:53-76`).
- **API** `app/api/support/route.ts:16-44`: zod validation + honeypot `website` field (`:13`), inserts feedback,
  emails support, records notification status.
- **UI** `SupportWidget` modal available to all tenant users (`components/shell.tsx:5,51`).

## What is MISSING for a platform operator / customer-success
- **Operator ticket triage: MISSING.** The `status` field (new/in_progress/resolved) is **never updated by any code**
  — no triage UI, no operator ticket list, no assignment, no reply thread. Support is effectively **email-only** (a
  Resend inbox).
- **Customer-health view: nonexistent.** No health score, no churn-risk signal, no account notes, no usage/engagement
  summary, no communication history, no "diagnostics for org X" surface.
- **Incidents / known issues: nonexistent.** No incident model or status surface anywhere.
- **Plan/onboarding state in a support context: MISSING cross-tenant.** Onboarding completion is tenant-scoped
  (`organization_onboarding`, see `02`); an operator cannot view the onboarding funnel or a customer's state.

## Implications
A Support/Customer-Success console (ticket queue with status/assignment/notes, per-customer health + diagnostics +
comms history, incident tracking) is **greenfield**. The feedback table already has the `status` lifecycle column, so
an operator triage queue is a comparatively small first step (read + update `feedback.status`, scoped by a new
platform guard) — but a true customer-health view depends on the cross-tenant read-models from `01`/`02`/`05`/`06`.
Impersonation/support-login (see `12`) is the other common CS need and is entirely absent today. See `13` GAP-SUP-*.
