/**
 * Coherence Program 1.3 — ONE trust/evidence vocabulary at the orchestration boundary.
 *
 * The reassessment found four parallel trust vocabularies: `DataTier` (data-trust.ts, the canonical
 * one used by the decision model), `CommerceTrustTier` (order-level provenance), `MemoryTrust`, and
 * the commerce recommendation `dataTrust` subset. This module makes `DataTier`/`DataTrust` the single
 * canonical vocabulary every orchestrated result speaks, and provides documented, lossless-where-
 * possible adapters from the domain-specific tiers. Nothing user-facing shows more than one definition
 * of "trusted".
 */
import type { DataTier, DataTrust } from '../data-trust';

export type { DataTier, DataTrust };

/** Canonical ordering so the lowest contributing tier caps a composed result (never averages up). */
const TIER_RANK: Record<DataTier, number> = {
  SYNTHETIC: -1,
  UNVERIFIED: 0,
  PLATFORM_REPORTED: 1,
  VALIDATED: 2,
  RECONCILED: 3,
};

/** The weakest of several tiers — a cross-domain claim is only as trustworthy as its weakest input. */
export function weakestTier(...tiers: DataTier[]): DataTier {
  if (tiers.length === 0) return 'UNVERIFIED';
  return tiers.reduce((lo, t) => (TIER_RANK[t] < TIER_RANK[lo] ? t : lo));
}

/**
 * Map a commerce order-provenance tier (`CommerceTrustTier`) to the canonical `DataTier`.
 * Documented, conservative mapping: verified/reconciled facts become the live reconciled/validated
 * tiers; merely-reported orders become PLATFORM_REPORTED; partial identity data cannot raise trust.
 */
export function fromCommerceOrderTier(tier: string): DataTier {
  switch (tier) {
    case 'REFUND_VERIFIED':
    case 'COST_VERIFIED':
      return 'RECONCILED';
    case 'COST_CONFIGURED':
    case 'FULFILLED_ORDER':
      return 'VALIDATED';
    case 'PAID_ORDER':
    case 'PLATFORM_ORDER':
      return 'PLATFORM_REPORTED';
    case 'CUSTOMER_ID_PARTIAL':
    default:
      return 'UNVERIFIED';
  }
}

/** The weakest canonical tier across a set of commerce order-provenance tiers. */
export function fromCommerceOrderTiers(tiers: readonly string[]): DataTier {
  if (tiers.length === 0) return 'UNVERIFIED';
  return weakestTier(...tiers.map(fromCommerceOrderTier));
}

/**
 * Map a memory trust label to the canonical `DataTier`. Human-set facts are the most trusted; derived
 * patterns are platform-reported at best; a connected-source-derived value cannot exceed platform.
 */
export function fromMemoryTrust(trust: string): DataTier {
  switch (trust) {
    case 'EXPLICIT_HUMAN':
      return 'VALIDATED';
    case 'CONNECTED_SOURCE':
      return 'PLATFORM_REPORTED';
    case 'DERIVED':
    case 'INFERRED':
      return 'UNVERIFIED';
    default:
      return 'UNVERIFIED';
  }
}

/** A compact, bilingual-free structured descriptor the UI renders into a single trust chip. */
export interface TrustSummary {
  tier: DataTier;
  /** True only when every contributing source is a live (non-synthetic) tier. */
  live: boolean;
  /** Short machine reason codes explaining any downgrade (never fabricated certainty). */
  notes: string[];
}

export function summarizeTrust(trusts: Array<Pick<DataTrust, 'tier'>>): TrustSummary {
  const tiers = trusts.map((t) => t.tier);
  const tier = weakestTier(...tiers);
  const hasSynthetic = tiers.includes('SYNTHETIC');
  const notes: string[] = [];
  if (hasSynthetic) notes.push('contains synthetic/demo data — not live evidence');
  if (tier === 'UNVERIFIED') notes.push('weakest contributing source is UNVERIFIED');
  return { tier, live: !hasSynthetic && tiers.length > 0, notes };
}
