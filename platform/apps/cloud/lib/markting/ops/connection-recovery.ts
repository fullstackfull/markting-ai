import type { ConnectionLifecycleState } from './connection-state-machine';

/**
 * PHASE C.6 (18) — CONNECTION RECOVERY POLICY.
 *
 * A PURE, deterministic map from an observed failure condition to the recommended recovery action and the
 * lifecycle state the connection should move into. NO model, NO heuristics, NO network: remediation is a
 * fixed table so the same condition always yields the same action, and the target state always ties back
 * to the connection state machine (./connection-state-machine.ts). This is the recovery analogue of the
 * deterministic ERROR_REMEDIATION table in lib/connections/vocabulary.ts.
 */
export const RECOVERY_CONDITIONS = [
  'AUTH_ERROR',
  'TOKEN_EXPIRED',
  'RATE_LIMIT',
  'SCHEMA_CHANGED',
  'SYNC_FAILED',
  'DISABLED',
] as const;
export type RecoveryCondition = (typeof RECOVERY_CONDITIONS)[number];

export const RECOVERY_ACTIONS = [
  'REAUTHORIZE',
  'REFRESH_OR_REAUTH',
  'BACKOFF',
  'QUARANTINE_AND_ALERT',
  'RETRY',
  'NO_EXECUTION',
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export interface RecoveryPlan {
  action: RecoveryAction;
  /** Lifecycle state the connection should transition into (a ConnectionLifecycleState). */
  nextState: ConnectionLifecycleState;
  /** Deterministic, secret-free rationale rendered verbatim in the audit trail / UI. */
  reason: string;
}

/**
 * The exhaustive recovery table. The `Record<RecoveryCondition, …>` type makes exhaustiveness a compile
 * error if a condition is ever added without a plan.
 *   AUTH_ERROR     → REAUTHORIZE          (grant invalid; only a fresh authorization fixes it)
 *   TOKEN_EXPIRED  → REFRESH_OR_REAUTH    (token engine refreshes if it can, else reauthorize)
 *   RATE_LIMIT     → BACKOFF              (provider throttling; wait, do not reconnect)
 *   SCHEMA_CHANGED → QUARANTINE_AND_ALERT (API shape changed; stop trusting the run, raise an incident)
 *   SYNC_FAILED    → RETRY                (a sync run failed; retry on schedule)
 *   DISABLED       → NO_EXECUTION         (operator hold; never execute, no recovery attempt)
 */
const RECOVERY_TABLE: Record<RecoveryCondition, RecoveryPlan> = {
  AUTH_ERROR: { action: 'REAUTHORIZE', nextState: 'REAUTH_REQUIRED', reason: 'The stored grant was rejected. Reauthorize the connection.' },
  TOKEN_EXPIRED: { action: 'REFRESH_OR_REAUTH', nextState: 'EXPIRED', reason: 'The access token expired. Refresh with the refresh token if available, otherwise reauthorize.' },
  RATE_LIMIT: { action: 'BACKOFF', nextState: 'DEGRADED', reason: 'The provider is rate-limiting requests. Back off and retry on a schedule; no reconnect needed.' },
  SCHEMA_CHANGED: { action: 'QUARANTINE_AND_ALERT', nextState: 'ERROR', reason: 'The provider changed its API shape. Quarantine the run and raise a provider-compatibility incident; a reconnect will not fix it.' },
  SYNC_FAILED: { action: 'RETRY', nextState: 'DEGRADED', reason: 'A data sync run failed. Retry the sync; repeated failures are a data-quality incident.' },
  DISABLED: { action: 'NO_EXECUTION', nextState: 'DISABLED', reason: 'The connection is disabled by an operator. Do not execute; no automated recovery is attempted.' },
};

/** Recommend a recovery plan for a condition. Pure and total over RecoveryCondition. */
export function recommendRecovery(condition: RecoveryCondition): RecoveryPlan {
  return RECOVERY_TABLE[condition];
}

/** Whether a condition permits any automated execution/recovery attempt at all (DISABLED does not). */
export function recoveryPermitsExecution(condition: RecoveryCondition): boolean {
  return RECOVERY_TABLE[condition].action !== 'NO_EXECUTION';
}
