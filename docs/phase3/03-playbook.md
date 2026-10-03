# 03 — Organization Playbook & Personalization (3I / 3J)

`playbook.ts`, `playbook-store.ts`, `markting_playbooks` (one row per org).

Fields: `budgetChangePolicy` (conservative/balanced/aggressive), `riskTolerance`, `scalingPreference`
(staged/standard), `protectedAccounts`, `protectedCampaigns`, `allowedRecommendationCategories`,
`approvalPreferences.autoApprovalThreshold`, `reportingPreferences`. Validated by a strict zod schema
(unknown keys stripped).

**Authority order: system safety > organization policy > AI suggestion.** The playbook can CONSTRAIN
and reshape suggestions; it can NEVER override a Phase-0 safety control, and `autoApprovalThreshold` is
advisory only — it cannot make anything auto-approvable below Phase-0 rules.

Personalization (`personalizeRecommendation`) is **phrasing-only**:
- a conservative/staged policy adds a "review a smaller staged increase" note to a scale review;
- a protected account/campaign adds a "requires explicit senior review" note;
- a non-preferred category is de-emphasized (lower priority), **except** `TRACKING_REVIEW`,
  `DATA_QUALITY_REVIEW`, `ANOMALY_REVIEW`, which are never suppressed by preference.

Crucially, the recommendation's **confidence, risk, status, evidence and dataTrust are returned
unchanged**. The playbook never makes weak evidence look stronger because the organization likes
aggressive growth — deterministic evidence gates are identical regardless of policy.
