/**
 * Phase 7A — PRODUCTION ACTION ALLOWLIST. The only typed actions eligible for controlled,
 * human-approved execution. Everything else FAILS CLOSED (unknown action → refused). Destructive or
 * high-complexity actions (deletion, arbitrary mutation, targeting rewrite, creative publishing,
 * bid-strategy migration, account-level destructive actions) are deliberately NOT enabled here.
 *
 * This never bypasses the Phase-0 path: an allowlisted action still flows
 * recommendation → typed action → policy validation → immutable preview → human approval →
 * apply-time revalidation → atomic claim → provider write → result → audit → outcome.
 */
import type { PermissionKey } from './rbac';

export const PRODUCTION_ACTIONS = ['SET_DAILY_BUDGET', 'PAUSE_ENTITY', 'RESUME_ENTITY'] as const;
export type ProductionActionType = (typeof PRODUCTION_ACTIONS)[number];

export type RiskClass = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type Reversibility = 'EASILY_REVERSIBLE' | 'REVERSIBLE_WITH_COST' | 'DIFFICULT_TO_REVERSE';

export interface ActionDefinition {
  type: ProductionActionType;
  supportedProviders: string[];
  riskClass: RiskClass;
  requiredPermission: PermissionKey;      // server-enforced permission to EXECUTE
  reversibility: Reversibility;
  rollbackStrategy: 'restore_previous_value' | 'resume_if_was_active' | 'none';
  /** Max single-step budget delta as a fraction of the current value (null = n/a). */
  maxDeltaFraction: number | null;
  /** Minimum data-trust tier required to even propose the action. */
  requiredDataTrust: 'PLATFORM_REPORTED' | 'VALIDATED' | 'RECONCILED';
  /** Live-state checks that apply-time revalidation must pass before the provider write. */
  requiredLiveStateChecks: Array<'target_ownership' | 'entity_exists' | 'currency_match' | 'current_value' | 'entity_status'>;
}

export const ACTION_ALLOWLIST: Record<ProductionActionType, ActionDefinition> = {
  SET_DAILY_BUDGET: {
    type: 'SET_DAILY_BUDGET',
    supportedProviders: ['meta', 'google', 'tiktok', 'snapchat', 'sandbox'],
    riskClass: 'MODERATE',
    requiredPermission: 'execute_approved_operation',
    reversibility: 'EASILY_REVERSIBLE',
    rollbackStrategy: 'restore_previous_value',
    maxDeltaFraction: 0.5,                 // a single governed step may not move budget more than ±50%
    requiredDataTrust: 'PLATFORM_REPORTED',
    requiredLiveStateChecks: ['target_ownership', 'entity_exists', 'currency_match', 'current_value'],
  },
  PAUSE_ENTITY: {
    type: 'PAUSE_ENTITY',
    supportedProviders: ['meta', 'google', 'tiktok', 'snapchat', 'sandbox'],
    riskClass: 'MODERATE',
    requiredPermission: 'execute_approved_operation',
    reversibility: 'REVERSIBLE_WITH_COST',   // learning-phase reset cost
    rollbackStrategy: 'resume_if_was_active',
    maxDeltaFraction: null,
    requiredDataTrust: 'PLATFORM_REPORTED',
    requiredLiveStateChecks: ['target_ownership', 'entity_exists', 'entity_status'],
  },
  RESUME_ENTITY: {
    type: 'RESUME_ENTITY',
    supportedProviders: ['meta', 'google', 'tiktok', 'snapchat', 'sandbox'],
    riskClass: 'MODERATE',
    requiredPermission: 'execute_approved_operation',
    reversibility: 'REVERSIBLE_WITH_COST',
    rollbackStrategy: 'none',               // resume only where prior state proves it was active
    maxDeltaFraction: null,
    requiredDataTrust: 'PLATFORM_REPORTED',
    requiredLiveStateChecks: ['target_ownership', 'entity_exists', 'entity_status'],
  },
};

/** Resolve an allowlisted action, or fail closed. */
export function resolveAction(type: string): ActionDefinition | { error: 'UNKNOWN_ACTION' } {
  return (PRODUCTION_ACTIONS as readonly string[]).includes(type)
    ? ACTION_ALLOWLIST[type as ProductionActionType]
    : { error: 'UNKNOWN_ACTION' };
}

export interface TypedProposedAction {
  type: ProductionActionType;
  provider: string;
  accountId: string;
  entityId: string;
  entityLevel: 'campaign' | 'ad_set' | 'ad';
  /** For SET_DAILY_BUDGET: the intended new value (minor units) + currency + the observed current value. */
  budget?: { toMinor: number; fromMinor?: number; currency: string };
  /** For PAUSE/RESUME: the intended status. */
  status?: 'PAUSED' | 'ACTIVE';
}

export type ActionValidation = { ok: true; definition: ActionDefinition } | { ok: false; reasons: string[] };

/** Validate a typed proposed action against its allowlist definition (pre-preview). Fails closed. */
export function validateProposedAction(a: TypedProposedAction, dataTrust: string): ActionValidation {
  const def = resolveAction(a.type);
  if ('error' in def) return { ok: false, reasons: ['UNKNOWN_ACTION — not on the production allowlist'] };
  const reasons: string[] = [];
  if (!def.supportedProviders.includes(a.provider)) reasons.push(`provider ${a.provider} not supported for ${a.type}`);
  const trustRank = ['PLATFORM_REPORTED', 'VALIDATED', 'RECONCILED'];
  if (trustRank.indexOf(dataTrust) < trustRank.indexOf(def.requiredDataTrust)) reasons.push(`data trust ${dataTrust} below required ${def.requiredDataTrust}`);
  if (a.type === 'SET_DAILY_BUDGET') {
    if (!a.budget) reasons.push('SET_DAILY_BUDGET requires a budget target');
    else if (a.budget.fromMinor != null && def.maxDeltaFraction != null && a.budget.fromMinor > 0) {
      const frac = Math.abs(a.budget.toMinor - a.budget.fromMinor) / a.budget.fromMinor;
      if (frac > def.maxDeltaFraction) reasons.push(`budget delta ${Math.round(frac * 100)}% exceeds max ${Math.round(def.maxDeltaFraction * 100)}% for a single governed step`);
    }
    if (a.budget && a.budget.toMinor < 0) reasons.push('budget cannot be negative');
  }
  if ((a.type === 'PAUSE_ENTITY' && a.status !== 'PAUSED') || (a.type === 'RESUME_ENTITY' && a.status !== 'ACTIVE')) reasons.push('status does not match the action type');
  return reasons.length ? { ok: false, reasons } : { ok: true, definition: def };
}
