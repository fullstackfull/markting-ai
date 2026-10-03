/**
 * Phase 3E/3F/3T — Marketing Memory core (pure policy; the DB store is memory-store.ts). Memory is
 * typed, provenance-bearing, tenant-scoped business state that INFORMS recommendations. The LLM never
 * writes memory directly — every write passes this deterministic, schema-validated policy:
 *  - source is allowlisted; provider/ad content is NOT an allowed source for trusted memory (poisoning
 *    defense, 3T): advertising text can never become a preference/fact;
 *  - a DERIVED memory may never override an EXPLICIT human-configured rule (trust ordering);
 *  - high-impact preferences require explicit human confirmation.
 * Memory is correctable/forgettable; it is NOT immutable audit history.
 */
import { z } from 'zod';

export const MEMORY_CATEGORIES = ['explicit_fact', 'human_preference', 'historical_decision', 'historical_outcome', 'operational_context'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_SOURCES = ['human_config', 'human_confirmation', 'system_verification', 'derived_analysis', 'connected_source'] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_TRUST = ['EXPLICIT_HUMAN', 'SYSTEM_VERIFIED', 'DERIVED_HIGH_CONFIDENCE', 'DERIVED_LOW_CONFIDENCE', 'STALE', 'REVOKED'] as const;
export type MemoryTrust = (typeof MEMORY_TRUST)[number];
export const TRUST_RANK: Record<MemoryTrust, number> = { EXPLICIT_HUMAN: 5, SYSTEM_VERIFIED: 4, DERIVED_HIGH_CONFIDENCE: 3, DERIVED_LOW_CONFIDENCE: 2, STALE: 1, REVOKED: 0 };

export interface MemoryItem {
  organizationId: string;
  category: MemoryCategory;
  key: string;
  value: unknown;
  source: MemorySource;
  sourceReference?: string;
  trust: MemoryTrust;
  explicit: boolean;
  confidence?: string;
  createdAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}

/** Keys that materially change behavior and therefore require explicit human confirmation to set. */
export const HIGH_IMPACT_PREFERENCE_KEYS = new Set<string>([
  'auto_approval_threshold', 'protected_accounts', 'protected_campaigns', 'scaling_policy',
  'risk_tolerance', 'budget_change_policy', 'approval_preferences',
]);

/** Which sources are trusted for which categories. Provider/connected data can only be operational
 *  context or a derived (low-authority) signal — never a human preference, and for an explicit fact
 *  ONLY for the structural keys below (never free-text). */
const SOURCE_RULES: Record<MemoryCategory, MemorySource[]> = {
  explicit_fact: ['human_config', 'human_confirmation', 'system_verification', 'connected_source'],
  human_preference: ['human_config', 'human_confirmation'],
  historical_decision: ['system_verification'],
  historical_outcome: ['system_verification', 'derived_analysis'],
  operational_context: ['system_verification', 'connected_source', 'derived_analysis'],
};

/**
 * The ONLY explicit-fact keys a `connected_source` (a verified structured provider API read) may set.
 * These are structural, non-free-text fields. This is the CODE gate (not just a comment) that stops
 * attacker-controlled ad text (a campaign name / headline) from ever becoming a trusted fact (3T).
 */
export const CONNECTED_SOURCE_FACT_KEYS = new Set<string>([
  'reporting_currency', 'account_currency', 'account_timezone', 'account_status', 'attribution_basis',
  'market_country', 'ad_account_id', 'ad_account_name',
]);

export const memoryWriteSchema = z.object({
  // Optional in the payload: the store OVERRIDES it with the server-derived org (never trusts a
  // client/model-supplied org). Present here only so the pure policy function can be unit-tested.
  organizationId: z.string().min(1).optional(),
  category: z.enum(MEMORY_CATEGORIES),
  key: z.string().min(1).max(128),
  value: z.unknown(),
  source: z.enum(MEMORY_SOURCES),
  sourceReference: z.string().max(512).optional(),
  explicit: z.boolean(),
  confidence: z.string().max(32).optional(),
  expiresAt: z.string().datetime().optional(),
}).strict();
export type MemoryWriteRequest = z.infer<typeof memoryWriteSchema>;

export interface WritePolicyResult { allowed: boolean; reason?: string; trust: MemoryTrust }

/** Minimal existing-item shape evaluateWritePolicy needs (the store supplies it). */
export interface ExistingForPolicy { trust: MemoryTrust; explicit: boolean; revokedAtPresent: boolean }

/** Derive the trust tier from source + explicitness (never model-chosen). */
export function trustForSource(source: MemorySource, explicit: boolean): MemoryTrust {
  if (source === 'human_config' || source === 'human_confirmation') return 'EXPLICIT_HUMAN';
  if (source === 'system_verification') return 'SYSTEM_VERIFIED';
  if (source === 'connected_source') return 'SYSTEM_VERIFIED';
  return explicit ? 'DERIVED_HIGH_CONFIDENCE' : 'DERIVED_LOW_CONFIDENCE';
}

/**
 * Decide whether a memory write is allowed, given the request and any existing item at the same key.
 * Pure — the store calls this before persisting. Enforces source rules, poisoning defense, trust
 * ordering (derived cannot override explicit), and the high-impact-confirmation rule.
 */
export function evaluateWritePolicy(req: MemoryWriteRequest, existing?: ExistingForPolicy | null): WritePolicyResult {
  const trust = trustForSource(req.source, req.explicit);

  // Source allowlist per category (poisoning defense — provider/ad text is never a valid source here,
  // because the service only ever calls this with the allowlisted sources above; 'connected_source'
  // is a verified provider API read, NOT free-text ad content).
  if (!SOURCE_RULES[req.category].includes(req.source)) {
    return { allowed: false, reason: `source ${req.source} is not allowed for category ${req.category}`, trust };
  }

  // Content gate (3T): a connected provider read may set an explicit fact ONLY for structural keys —
  // never a free-text key — so attacker-controlled ad content cannot become a trusted fact.
  if (req.category === 'explicit_fact' && req.source === 'connected_source' && !CONNECTED_SOURCE_FACT_KEYS.has(req.key)) {
    return { allowed: false, reason: `connected_source may only set structural fact keys, not "${req.key}" (prevents ad-content poisoning)`, trust };
  }

  // High-impact preferences require explicit human confirmation (not derived, not a single behavior).
  if (req.category === 'human_preference' && HIGH_IMPACT_PREFERENCE_KEYS.has(req.key)) {
    if (req.source !== 'human_config' && req.source !== 'human_confirmation') {
      return { allowed: false, reason: `high-impact preference "${req.key}" requires explicit human confirmation`, trust };
    }
  }

  // Trust ordering: a DERIVED write may not override an EXPLICIT human-configured item at the same key.
  if (existing && !existing.revokedAtPresent && existing.trust === 'EXPLICIT_HUMAN' && trust !== 'EXPLICIT_HUMAN') {
    return { allowed: false, reason: 'cannot overwrite an explicit human-configured value with a derived/system value', trust };
  }

  return { allowed: true, trust };
}

/** Is the memory item currently usable as evidence (not revoked, not expired, not STALE/REVOKED tier). */
export function isActive(item: Pick<MemoryItem, 'trust' | 'revokedAt' | 'expiresAt'>, now = Date.now()): boolean {
  if (item.revokedAt) return false;
  if (item.trust === 'REVOKED' || item.trust === 'STALE') return false;
  if (item.expiresAt && Date.parse(item.expiresAt) < now) return false;
  return true;
}
