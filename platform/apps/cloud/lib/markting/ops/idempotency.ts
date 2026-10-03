/**
 * Phase 7D/7Y — IDEMPOTENCY, ATOMIC CLAIM, and the hardest operational state: UNKNOWN_RESULT.
 *
 * Exactly-once is only claimed where a provider supports an idempotency key. Otherwise we rely on a
 * LOCAL ATOMIC CLAIM + an immutable operation identity + post-failure RECONCILIATION — and we NEVER
 * blindly resend. When a provider write's result is unknown (timeout/connection drop), the operation
 * goes to UNKNOWN_RESULT and may only advance after reconciliation proves what actually happened.
 */
import { createHash } from 'node:crypto';
import type { TypedProposedAction } from './actions';

/** Deterministic operation digest over the EXACT approved action (used for idempotency + revalidation). */
export function operationDigest(a: TypedProposedAction, policyVersion: string): string {
  const canonical = JSON.stringify({
    type: a.type, provider: a.provider, accountId: a.accountId, entityId: a.entityId, entityLevel: a.entityLevel,
    // fromMinor is bound into the identity so the approved operation carries the exact baseline the
    // delta cap was evaluated against — it cannot be swapped out between preview and apply.
    budget: a.budget ? { toMinor: a.budget.toMinor, fromMinor: a.budget.fromMinor ?? null, currency: a.budget.currency } : null, status: a.status ?? null, policyVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Provider idempotency capability. Keys are derived from the operation digest (stable per operation). */
export const PROVIDER_IDEMPOTENCY: Record<string, { supportsKey: boolean; note: string }> = {
  meta: { supportsKey: false, note: 'Graph API has no general idempotency key; rely on atomic claim + reconciliation' },
  google: { supportsKey: true, note: 'Google Ads supports operation-level validate + request id' },
  tiktok: { supportsKey: false, note: 'no general idempotency key; atomic claim + reconciliation' },
  snapchat: { supportsKey: false, note: 'no general idempotency key; atomic claim + reconciliation' },
  sandbox: { supportsKey: true, note: 'test adapter supports an idempotency key' },
};

export function idempotencyKeyFor(provider: string, digest: string): string | null {
  return PROVIDER_IDEMPOTENCY[provider]?.supportsKey ? `markting-${digest.slice(0, 32)}` : null;
}

export function claimsExactlyOnce(provider: string): boolean {
  return PROVIDER_IDEMPOTENCY[provider]?.supportsKey ?? false;
}

// ---- Atomic claim ----
export type ClaimResult = { claimed: true; claimToken: string } | { claimed: false; reason: 'ALREADY_CLAIMED' | 'NOT_APPROVED' };

/**
 * Model of the atomic claim: the store performs a conditional single-row UPDATE (APPROVED→CLAIMED with
 * a fresh token) so only ONE worker can ever claim an operation. This pure helper validates the
 * precondition; the store enforces atomicity in SQL (see store.claimOperation).
 */
export function evaluateClaim(current: { state: string; claimToken?: string | null }): ClaimResult {
  if (current.state !== 'APPROVED') return { claimed: false, reason: 'NOT_APPROVED' };
  if (current.claimToken) return { claimed: false, reason: 'ALREADY_CLAIMED' };
  return { claimed: true, claimToken: createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24) };
}

// ---- Reconciliation (7Y) ----
export type ReconciliationVerdict =
  | { verdict: 'APPLIED_CONFIRMED'; evidence: string }
  | { verdict: 'SAFE_TO_RETRY'; evidence: string }
  | { verdict: 'STILL_UNKNOWN'; evidence: string };

/**
 * Reconcile an UNKNOWN_RESULT by comparing the intended state with the provider's actual fetched state.
 * - actual == intended → APPLIED_CONFIRMED (no retry).
 * - actual == the pre-change value AND the action type is safely idempotent/reversible → SAFE_TO_RETRY.
 * - otherwise → STILL_UNKNOWN (never a blind resend).
 */
export function reconcileUnknownResult(input: {
  action: TypedProposedAction;
  intended: { budgetMinor?: number; status?: 'ACTIVE' | 'PAUSED' };
  actual?: { budgetMinor?: number; status?: 'ACTIVE' | 'PAUSED' } | null;
  pre?: { budgetMinor?: number; status?: 'ACTIVE' | 'PAUSED' };
}): ReconciliationVerdict {
  if (!input.actual) return { verdict: 'STILL_UNKNOWN', evidence: 'could not fetch the provider entity state' };
  const matches = (x?: number | 'ACTIVE' | 'PAUSED', y?: number | 'ACTIVE' | 'PAUSED') => x != null && x === y;
  if (input.action.type === 'SET_DAILY_BUDGET') {
    if (matches(input.actual.budgetMinor, input.intended.budgetMinor)) return { verdict: 'APPLIED_CONFIRMED', evidence: `provider budget == intended (${input.intended.budgetMinor})` };
    if (input.pre && matches(input.actual.budgetMinor, input.pre.budgetMinor)) return { verdict: 'SAFE_TO_RETRY', evidence: 'provider budget still at the pre-change value — the write did not land' };
    return { verdict: 'STILL_UNKNOWN', evidence: `provider budget ${input.actual.budgetMinor} matches neither intended nor pre-change` };
  }
  // PAUSE/RESUME
  const target = input.action.status;
  if (matches(input.actual.status, target)) return { verdict: 'APPLIED_CONFIRMED', evidence: `provider status == intended (${target})` };
  if (input.pre && matches(input.actual.status, input.pre.status)) return { verdict: 'SAFE_TO_RETRY', evidence: 'provider status still at the pre-change value' };
  return { verdict: 'STILL_UNKNOWN', evidence: `provider status ${input.actual.status} matches neither intended nor pre-change` };
}
