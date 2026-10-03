/**
 * Phase 6K/6L — HARD and SOFT constraints for allocation. Hard constraints are inviolable bounds (org
 * max budget, per-account/campaign caps, protected campaigns, min spend floors, margin/inventory/
 * experiment exclusions); no recommendation may override them, and none may override Phase-0 safety.
 * Soft constraints are PREFERENCES that shape ranking but never breach a hard constraint.
 */

export interface HardConstraints {
  orgMaxBudgetMinor?: number;
  currency?: string;
  accountCaps?: Record<string, number>;           // accountId → max budget minor
  campaignBounds?: Record<string, { minMinor?: number; maxMinor?: number }>;
  protectedCampaignIds?: string[];                 // never reduced below current
  protectedAccountIds?: string[];
  minSpendFloorMinor?: number;                     // per-candidate floor
  riskTolerance?: 'LOW' | 'MODERATE' | 'HIGH';
  marginFloorPct?: number;
  inventoryConstrainedIds?: string[];              // candidates whose scaling confidence is reduced
  experimentExcludedIds?: string[];                // in an active experiment — excluded from reallocation
}

export interface SoftConstraints {
  conservativeScaling?: boolean;
  minimizeVolatility?: boolean;
  favorProfitableGrowth?: boolean;
  favorAcquisitionVolume?: boolean;
  preserveBrandCampaigns?: boolean;
  maintainChannelDiversification?: boolean;
}

export interface Candidate {
  id: string;
  accountId?: string;
  channel?: string;
  currentBudgetMinor: number;
  currency: string;
  role?: 'direct_response' | 'brand' | 'strategic' | 'acquisition' | 'retention';
}

/** The maximum budget a candidate may be RAISED to under the hard constraints (or null if capped out). */
export function maxAllowedForCandidate(c: Candidate, hard: HardConstraints): number {
  const bounds = hard.campaignBounds?.[c.id];
  let cap = bounds?.maxMinor ?? Number.POSITIVE_INFINITY;
  if (c.accountId && hard.accountCaps?.[c.accountId] != null) cap = Math.min(cap, hard.accountCaps[c.accountId]!);
  if (hard.orgMaxBudgetMinor != null) cap = Math.min(cap, hard.orgMaxBudgetMinor);
  return cap;
}

/** The minimum a candidate may be REDUCED to (protected/floor-aware). */
export function minAllowedForCandidate(c: Candidate, hard: HardConstraints): number {
  if (hard.protectedCampaignIds?.includes(c.id)) return c.currentBudgetMinor; // protected: never reduced
  if (c.accountId && hard.protectedAccountIds?.includes(c.accountId)) return c.currentBudgetMinor;
  const bounds = hard.campaignBounds?.[c.id];
  return Math.max(bounds?.minMinor ?? 0, hard.minSpendFloorMinor ?? 0);
}

/** Candidates eligible to RECEIVE additional budget (not protected-only, not experiment-excluded, same currency). */
export function receiveEligible(c: Candidate, hard: HardConstraints): { eligible: boolean; reason?: string } {
  if (hard.experimentExcludedIds?.includes(c.id)) return { eligible: false, reason: 'in an active experiment (excluded from reallocation)' };
  if (hard.currency && c.currency !== hard.currency) return { eligible: false, reason: `currency ${c.currency} ≠ allocation currency ${hard.currency}` };
  if (maxAllowedForCandidate(c, hard) <= c.currentBudgetMinor) return { eligible: false, reason: 'already at its hard cap' };
  return { eligible: true };
}
