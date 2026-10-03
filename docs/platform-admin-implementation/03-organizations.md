# 03 — Organizations (READY read; PARTIAL actions)
`/admin/organizations` — searchable, server-paginated list (name/slug/plan/status/members/ad-accounts/created),
bounded `limit/offset`, never a full-table load. `/admin/organizations/[id]` — plan, status, Stripe customer,
onboarding, members (→ user drill-down), connections (status + last error), ad accounts, AI usage, active kill
switches. Action READY: **freeze/unfreeze provider writes** (ORGANIZATION kill switch, enforced WAVE 0,
reason-required, audited, READ_ONLY_AUDITOR denied). PARTIAL: disable-AI, extend-trial, assign-plan, entitlement
override, delete (need the plans/billing/overrides backend — Waves 7-8 roadmap).
