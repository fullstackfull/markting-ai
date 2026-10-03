# 01 — Account & Campaign Workflows — DONE (account) / PARTIAL (campaign)

- **Account Intelligence** (`app/dashboard/accounts/[accountId]`) — DONE. One connected drill-down
  composing diagnosis → pacing → anomaly → forecast → creative → commerce → outcomes, all from the
  orchestrator sections, bilingual/RTL, demo-marked. Reachable route (verified by `next build`).
- **Campaign** — PARTIAL. Campaign-scoped diagnosis is answerable via the Assistant (CAMPAIGN_DIAGNOSIS)
  and appears within the account view; a dedicated `/dashboard/campaigns/[id]` route with the full
  per-campaign layout (CTR/CPM/CPC/frequency panel, per-campaign creative list) was not built this pass.
