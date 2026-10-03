/**
 * Phase 7W — CHANGE MANAGEMENT. Important system/policy configuration changes (policy updates, budget
 * limits, protected-account changes, approval-policy changes, model-allowlist changes, kill-switch
 * changes) produce immutable change records: who / what / before / after / why / when. These are not
 * provider writes — they are governance config changes — but they are audited like one.
 */
export const CHANGE_TYPES = [
  'policy_update', 'budget_limit_change', 'protected_account_change', 'approval_policy_change',
  'model_allowlist_change', 'kill_switch_change', 'service_account_change', 'member_role_change',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export interface ChangeRecord {
  organizationId: string;
  changeType: ChangeType;
  actorUserId: string;
  before: unknown;
  after: unknown;
  reason: string;
  at: string;          // ISO
}

/** Build an immutable change record. The store appends it (insert-only); it is never updated/deleted. */
export function changeRecord(input: Omit<ChangeRecord, 'at'> & { at?: string }): ChangeRecord {
  if (!input.reason || input.reason.trim().length === 0) throw new Error('a change record requires a reason');
  return { ...input, at: input.at ?? new Date().toISOString() };
}
