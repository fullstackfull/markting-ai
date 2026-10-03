/**
 * Phase 7B — ENTERPRISE APPROVAL POLICY ENGINE (an EXTENSION of the Phase-0 policy engine, not a
 * duplicate). It decides how many and which approvals an operation needs, and whether a collected set
 * of approvals SATISFIES the requirement. Hard invariants: requester ≠ approver, no duplicate actor may
 * satisfy two required approvals, protected accounts need a senior approver, and only humans count
 * (the AI and service accounts can never approve — enforced in rbac.canApprove).
 */
import { canApprove, type Principal, type Role } from './rbac';
import type { RiskClass } from './actions';

export interface ApprovalRequirement {
  /** Distinct human approvers required. */
  quorum: number;
  /** When true, at least one approver must hold a senior role (OWNER/ADMIN/AGENCY_ADMIN). */
  requireSenior: boolean;
  reasons: string[];
}

export interface PolicyInputs {
  riskClass: RiskClass;
  /** Absolute financial exposure of the change, in minor units (same currency as budget). */
  financialExposureMinor?: number;
  /** Budget delta as a fraction of the current value, when applicable. */
  budgetDeltaFraction?: number;
  protectedAccount?: boolean;
  campaignClassification?: 'standard' | 'brand' | 'strategic';
  /** Org-configured thresholds (minor units). */
  highValueThresholdMinor?: number;
}

const SENIOR_ROLES: Role[] = ['OWNER', 'ADMIN', 'AGENCY_ADMIN'];

/** Determine the approval requirement for an operation. Conservative: escalates, never relaxes. */
export function requiredApprovals(p: PolicyInputs): ApprovalRequirement {
  const reasons: string[] = [];
  let quorum = 1;
  let requireSenior = false;
  const highValue = p.highValueThresholdMinor ?? 500_00; // default 500.00 in minor units

  if (p.riskClass === 'HIGH' || p.riskClass === 'CRITICAL') { quorum = Math.max(quorum, 2); reasons.push(`risk ${p.riskClass} → second approver`); }
  if ((p.financialExposureMinor ?? 0) >= highValue) { quorum = Math.max(quorum, 2); reasons.push('high financial exposure → second approver'); }
  if ((p.budgetDeltaFraction ?? 0) >= 0.3) { quorum = Math.max(quorum, 2); reasons.push('large budget delta → second approver'); }
  if (p.protectedAccount) { requireSenior = true; quorum = Math.max(quorum, 2); reasons.push('protected account → senior second approver'); }
  if (p.campaignClassification === 'brand' || p.campaignClassification === 'strategic') { requireSenior = true; reasons.push(`${p.campaignClassification} campaign → senior approver`); }
  if (reasons.length === 0) reasons.push('standard single-approver policy');
  return { quorum, requireSenior, reasons };
}

export interface CollectedApproval {
  actorUserId: string;
  actor: Principal;
  roles: Role[];
  approvedAt: string;
}

export type QuorumResult =
  | { satisfied: true; approverCount: number }
  | { satisfied: false; reason: string; have: number; need: number };

/**
 * Evaluate whether collected approvals satisfy the requirement. Rejects duplicate actors, the
 * requester approving, non-human approvers, and a missing senior when required.
 */
export function evaluateQuorum(input: {
  requirement: ApprovalRequirement;
  requesterUserId: string;
  approvals: CollectedApproval[];
}): QuorumResult {
  const seen = new Set<string>();
  const valid: CollectedApproval[] = [];
  for (const a of input.approvals) {
    if (seen.has(a.actorUserId)) continue;                 // no duplicate actor satisfies two approvals
    const sod = canApprove({ requesterUserId: input.requesterUserId, actorUserId: a.actorUserId, actor: a.actor });
    if (!sod.ok) continue;                                 // requester / AI / service account / no-perm excluded
    seen.add(a.actorUserId);
    valid.push(a);
  }
  if (input.requirement.requireSenior && !valid.some((a) => a.roles.some((r) => SENIOR_ROLES.includes(r)))) {
    return { satisfied: false, reason: 'a senior approver (OWNER/ADMIN/AGENCY_ADMIN) is required', have: valid.length, need: input.requirement.quorum };
  }
  if (valid.length < input.requirement.quorum) {
    return { satisfied: false, reason: `need ${input.requirement.quorum} distinct human approvers, have ${valid.length}`, have: valid.length, need: input.requirement.quorum };
  }
  return { satisfied: true, approverCount: valid.length };
}

// ---- Apply-time revalidation (approval expiry + material-change detection) ----
export interface PreviewSnapshot {
  operationDigest: string;
  targetOwnershipOk: boolean;
  providerEntityExists: boolean;
  currentBudgetMinor?: number;
  currency?: string;
  entityStatus?: 'ACTIVE' | 'PAUSED';
  policyVersion: string;
  approvalExpiresAt: string;      // ISO
}

export interface LiveSnapshot {
  targetOwnershipOk: boolean;
  providerEntityExists: boolean;
  currentBudgetMinor?: number;
  currency?: string;
  entityStatus?: 'ACTIVE' | 'PAUSED';
  policyVersion: string;
  operationDigest: string;        // recomputed from the exact approved operation
}

export type RevalidationResult = { ok: true } | { ok: false; code: 'REPREVIEW_REQUIRED' | 'EXPIRED'; reasons: string[] };

/**
 * Revalidate at apply time. A material change (ownership moved, entity gone, budget/currency changed,
 * status changed, policy version changed, or digest mismatch) → REPREVIEW_REQUIRED. Past expiry →
 * EXPIRED. A stale approval is NEVER silently reused.
 */
export function revalidateAtApply(preview: PreviewSnapshot, live: LiveSnapshot, now = Date.now()): RevalidationResult {
  if (now > Date.parse(preview.approvalExpiresAt)) return { ok: false, code: 'EXPIRED', reasons: ['approval/preview has expired'] };
  const reasons: string[] = [];
  if (preview.operationDigest !== live.operationDigest) reasons.push('operation digest mismatch (the approved operation is not the one being applied)');
  if (!live.targetOwnershipOk) reasons.push('target ownership changed or cannot be confirmed');
  if (!live.providerEntityExists) reasons.push('provider entity no longer exists');
  if (preview.policyVersion !== live.policyVersion) reasons.push('policy version changed since preview');
  if (preview.currency != null && live.currency != null && preview.currency !== live.currency) reasons.push('currency changed since preview');
  if (preview.currentBudgetMinor != null && live.currentBudgetMinor != null && preview.currentBudgetMinor !== live.currentBudgetMinor) reasons.push('current budget changed externally since preview');
  if (preview.entityStatus != null && live.entityStatus != null && preview.entityStatus !== live.entityStatus) reasons.push('entity status changed since preview');
  return reasons.length ? { ok: false, code: 'REPREVIEW_REQUIRED', reasons } : { ok: true };
}
