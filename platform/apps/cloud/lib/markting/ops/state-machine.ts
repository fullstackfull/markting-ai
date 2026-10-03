/**
 * Phase 7C — formal EXECUTION STATE MACHINE. Illegal transitions are refused server-side, so an
 * operation can never jump from (say) PENDING_APPROVAL straight to APPLIED. UNKNOWN_RESULT is a
 * first-class terminal-ish state (a provider write whose outcome is unknown) that may only move on via
 * reconciliation (→ APPLIED or back to a safe retry), never by a blind resend.
 */
export const OPERATION_STATES = [
  'DRAFT', 'PREVIEWED', 'PENDING_APPROVAL', 'PARTIALLY_APPROVED', 'APPROVED', 'CLAIMED', 'APPLYING',
  'APPLIED', 'FAILED', 'UNKNOWN_RESULT', 'EXPIRED', 'SUPERSEDED', 'REJECTED', 'CANCELLED',
  'ROLLBACK_REQUESTED', 'ROLLED_BACK',
] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

const TRANSITIONS: Record<OperationState, OperationState[]> = {
  DRAFT: ['PREVIEWED', 'CANCELLED', 'SUPERSEDED'],
  PREVIEWED: ['PENDING_APPROVAL', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  PENDING_APPROVAL: ['PARTIALLY_APPROVED', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  PARTIALLY_APPROVED: ['APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  APPROVED: ['CLAIMED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],           // revalidation may expire/supersede
  CLAIMED: ['APPLYING', 'FAILED', 'EXPIRED'],                            // atomic claim taken
  APPLYING: ['APPLIED', 'FAILED', 'UNKNOWN_RESULT'],
  APPLIED: ['ROLLBACK_REQUESTED'],
  FAILED: ['SUPERSEDED', 'CANCELLED'],                                   // a new governed op supersedes; no auto-retry
  UNKNOWN_RESULT: ['APPLIED', 'FAILED', 'ROLLBACK_REQUESTED'],           // only via reconciliation evidence
  EXPIRED: ['SUPERSEDED'],
  SUPERSEDED: [],
  REJECTED: [],
  CANCELLED: [],
  ROLLBACK_REQUESTED: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: [],
};

export function canTransition(from: OperationState, to: OperationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  constructor(public from: OperationState, public to: OperationState) {
    super(`illegal operation transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Assert a transition is legal; throw server-side otherwise. Pure guard — callers persist the state. */
export function assertTransition(from: OperationState, to: OperationState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function isTerminal(state: OperationState): boolean {
  return TRANSITIONS[state].length === 0;
}
