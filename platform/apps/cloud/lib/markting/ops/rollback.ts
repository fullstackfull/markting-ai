/**
 * Phase 7E — controlled ROLLBACK. There is NO magic transaction rollback for external APIs. A rollback
 * is a BRAND-NEW governed operation (its own preview → approval-if-required → apply → audit) that
 * restores the prior state, and only for safely reversible action types with proven prior state.
 */
import type { TypedProposedAction, ProductionActionType } from './actions';

export type RollbackPlan =
  | { reversible: true; action: TypedProposedAction; note: string }
  | { reversible: false; reason: string };

/**
 * Build the rollback action for an applied operation. Budget → restore the exact previous value.
 * Pause → resume ONLY if the captured prior state proves it was ACTIVE. Resume → not auto-rolled back
 * (re-pausing is a fresh decision). Everything is a new governed action, never an auto-execution.
 */
export function buildRollback(applied: {
  action: TypedProposedAction;
  before: { budgetMinor?: number; currency?: string; status?: 'ACTIVE' | 'PAUSED' };
}): RollbackPlan {
  const { action, before } = applied;
  const type: ProductionActionType = action.type;
  if (type === 'SET_DAILY_BUDGET') {
    if (before.budgetMinor == null || !before.currency) return { reversible: false, reason: 'previous budget value was not captured — cannot restore exactly' };
    return {
      reversible: true,
      note: 'restore the exact previous daily budget via a new governed SET_DAILY_BUDGET operation',
      action: { ...action, budget: { toMinor: before.budgetMinor, fromMinor: action.budget?.toMinor, currency: before.currency } },
    };
  }
  if (type === 'PAUSE_ENTITY') {
    if (before.status !== 'ACTIVE') return { reversible: false, reason: 'prior state does not prove the entity was ACTIVE — will not auto-resume' };
    return { reversible: true, note: 'resume the entity (prior state was ACTIVE) via a new governed RESUME_ENTITY operation', action: { ...action, type: 'RESUME_ENTITY', status: 'ACTIVE' } };
  }
  // RESUME_ENTITY and anything else: re-pausing is a fresh decision, not a mechanical rollback.
  return { reversible: false, reason: `${type} is not mechanically rolled back — any reversal is a fresh governed decision` };
}
