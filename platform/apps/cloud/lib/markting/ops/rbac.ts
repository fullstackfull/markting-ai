/**
 * Phase 7I — RBAC / ABAC + SEGREGATION OF DUTIES. Roles map to permissions; permissions are enforced
 * SERVER-SIDE. Segregation-of-duties rules are hard invariants the approval/execution engine consults:
 * a requester cannot approve their own operation, an analyst cannot execute, the AI/model can neither
 * approve nor write, and a service account can never satisfy a HUMAN approval requirement.
 */

export const ROLES = ['OWNER', 'ADMIN', 'MEDIA_BUYER', 'ANALYST', 'APPROVER', 'VIEWER', 'AGENCY_ADMIN', 'CLIENT_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'view_account', 'view_commerce', 'use_ai', 'create_recommendation', 'request_preview',
  'approve', 'execute_approved_operation', 'manage_policies', 'manage_secrets', 'manage_billing',
  'manage_members', 'emergency_lock',
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: ['view_account', 'view_commerce', 'use_ai', 'create_recommendation', 'request_preview', 'approve', 'execute_approved_operation', 'manage_policies', 'manage_members', 'emergency_lock'],
  AGENCY_ADMIN: ['view_account', 'view_commerce', 'use_ai', 'create_recommendation', 'request_preview', 'approve', 'execute_approved_operation', 'manage_policies', 'manage_members', 'emergency_lock'],
  CLIENT_ADMIN: ['view_account', 'view_commerce', 'use_ai', 'create_recommendation', 'request_preview', 'approve', 'execute_approved_operation', 'manage_members'],
  MEDIA_BUYER: ['view_account', 'view_commerce', 'use_ai', 'create_recommendation', 'request_preview', 'execute_approved_operation'],
  APPROVER: ['view_account', 'view_commerce', 'approve'],
  ANALYST: ['view_account', 'view_commerce', 'use_ai', 'create_recommendation', 'request_preview'],
  VIEWER: ['view_account', 'view_commerce'],
};

export interface Principal {
  userId: string;
  roles: Role[];
  /** True when this principal is a non-human service account (cannot approve human requirements). */
  isServiceAccount?: boolean;
  /** True when this "principal" is the AI/model acting — may NEVER approve or execute. */
  isModel?: boolean;
}

export function permissionsFor(roles: Role[]): Set<PermissionKey> {
  const out = new Set<PermissionKey>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return out;
}

export function can(principal: Principal, permission: PermissionKey): boolean {
  if (principal.isModel) return permission === 'use_ai' || permission === 'create_recommendation'; // the model may analyze/propose, nothing else
  return permissionsFor(principal.roles).has(permission);
}

// ---- Segregation of duties (hard invariants) ----
export interface SodContext { requesterUserId: string; actorUserId: string; actor: Principal }

/** Can this actor APPROVE this operation? Enforces 4-eyes + no-AI + no-service-account-for-human-approval. */
export function canApprove(ctx: SodContext): { ok: boolean; reason?: string } {
  if (ctx.actor.isModel) return { ok: false, reason: 'the AI/model can never approve an operation' };
  if (ctx.actor.isServiceAccount) return { ok: false, reason: 'a service account cannot satisfy a human approval requirement' };
  if (!can(ctx.actor, 'approve')) return { ok: false, reason: 'actor lacks the approve permission' };
  if (ctx.actorUserId === ctx.requesterUserId) return { ok: false, reason: '4-eyes: the requester cannot approve their own operation' };
  return { ok: true };
}

/** Can this actor EXECUTE an approved operation? */
export function canExecute(actor: Principal): { ok: boolean; reason?: string } {
  if (actor.isModel) return { ok: false, reason: 'the AI/model can never execute a provider write' };
  if (!can(actor, 'execute_approved_operation')) return { ok: false, reason: 'actor lacks the execute permission' };
  return { ok: true };
}

/** Billing-admin isolation: managing billing never implies ad-write/execute rights. */
export function billingAdminHasAdWrite(roles: Role[]): boolean {
  return permissionsFor(roles).has('execute_approved_operation');
}
