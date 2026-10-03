# 02 — Approval Policies & Quorum (7B)

`ops/approval-policy.ts` EXTENDS the Phase-0 policy engine (it does not duplicate it).

## Requirement (`requiredApprovals`)

Derived conservatively from risk class, absolute financial exposure, budget-delta fraction, protected
account, and campaign classification. Escalations: HIGH/CRITICAL risk → 2 approvers; high financial
exposure → 2; budget delta ≥ 30% → 2; protected account → senior + 2; brand/strategic → senior.

## Quorum (`evaluateQuorum`)

Counts only DISTINCT, VALID human approvals. Rejected: duplicate actor (one actor can satisfy at most
one required approval), the requester (4-eyes), the AI/model, service accounts, and anyone lacking the
approve permission. When a senior approver is required, at least one must hold OWNER/ADMIN/AGENCY_ADMIN.

## Apply-time revalidation (`revalidateAtApply`)

A preview approval EXPIRES. At apply time we re-check target ownership, provider entity existence,
current budget, currency, entity status, policy version, the operation digest, and expiry. A material
change → `REPREVIEW_REQUIRED`; past expiry → `EXPIRED`. A stale approval is NEVER silently reused.
