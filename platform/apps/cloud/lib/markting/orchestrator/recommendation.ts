/**
 * Coherence Program 1.5 — ONE recommendation lifecycle at the product boundary.
 *
 * The reassessment found four parallel recommendation pipelines (media `Recommendation`,
 * `CreativeRecommendation`, `CommerceRecommendation`, `OptimizationRecommendation`) with four return
 * types and no unifier — so no single product surface could list "my recommendations". This module
 * defines ONE `UnifiedRecommendation` the Recommendation Center and the orchestrator speak, and
 * lossless adapters from each domain pipeline. The native domain generators are REUSED unchanged (and
 * only deprecated later, Program 25); their native `evidence` records are preserved verbatim under
 * `evidenceDetail` so nothing is lost.
 *
 * SAFETY: like every source recommendation, a `UnifiedRecommendation` carries only a typed review
 * intent and evidence — never an endpoint/path/body. Accepting one moves it to ACCEPTED_FOR_PREVIEW;
 * a provider change still requires the Phase-0 human-approved preview/apply path.
 */
import { randomUUID } from 'node:crypto';
import type { BiText, Recommendation, Confidence, Risk, ExpectedImpact, RecommendationStatus } from '../intelligence/decision-model';
import type { CreativeRecommendation } from '../creative/recommendations';
import type { CommerceRecommendation } from '../commerce/diagnostics';
import type { OptimizationRecommendation } from '../optimize/recommendations';
import type { DataTier } from '../data-trust';

export const RECOMMENDATION_DOMAINS = ['MEDIA', 'CREATIVE', 'COMMERCE', 'OPTIMIZE'] as const;
export type RecommendationDomain = (typeof RECOMMENDATION_DOMAINS)[number];

/** Normalize the three-level and four-level risk vocabularies onto the canonical four-level Risk. */
function normalizeRisk(r: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL'): Risk {
  return r;
}

/** The single product-facing recommendation. All domains map onto this; no other type reaches the UI. */
export interface UnifiedRecommendation {
  recommendationId: string;
  domain: RecommendationDomain;
  organizationId: string;
  /** Best-effort entity scope (whichever of account/campaign/creative/store the domain provided). */
  scope: {
    accountId?: string;
    campaignId?: string;
    creativeId?: string;
    clusterId?: string;
    storeId?: string;
    channel?: string;
    entityLevel?: string;
    name?: string;
  };
  /** A stable category string (domain-prefixed to stay unambiguous across pipelines). */
  category: string;
  reasoning: BiText;
  confidence: Confidence;
  risk: Risk;
  dataTrust: DataTier;
  expectedImpact: ExpectedImpact;
  /** The native evidence record from the source pipeline, preserved verbatim for drill-down. */
  evidenceDetail: Record<string, unknown>;
  /** Optional historical context (already bilingual) when the source supplied it. */
  historicalContext?: BiText;
  /** Review workbench references (scenario/experiment), never execution endpoints. */
  refs?: { scenarioId?: string; experimentId?: string };
  requiresHumanApproval: true;
  status: RecommendationStatus;
  createdAt: string;
  expiresAt?: string;
}

const confidenceOf = (c: 'LOW' | 'MEDIUM' | 'HIGH'): Confidence => c;

export function fromMediaRecommendation(r: Recommendation): UnifiedRecommendation {
  return {
    recommendationId: r.recommendationId,
    domain: 'MEDIA',
    organizationId: r.organizationId,
    scope: { accountId: r.accountId, entityLevel: r.entityScope.entityLevel, name: r.entityScope.name, campaignId: r.entityScope.entityLevel === 'campaign' ? r.entityScope.entityId : undefined },
    category: `MEDIA:${r.category}`,
    reasoning: r.reasoning,
    confidence: r.confidence,
    risk: r.risk,
    dataTrust: r.dataTrust,
    expectedImpact: r.expectedImpact,
    evidenceDetail: { diagnosis: r.diagnosis.type, actionType: r.actionType, evidence: r.evidence, alternatives: r.alternatives },
    requiresHumanApproval: true,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

export function fromCreativeRecommendation(r: CreativeRecommendation, opts: { id?: string; createdAt?: string } = {}): UnifiedRecommendation {
  return {
    recommendationId: opts.id ?? randomUUID(),
    domain: 'CREATIVE',
    organizationId: r.organizationId,
    scope: { accountId: r.accountId, campaignId: r.scope.campaignId, creativeId: r.scope.creativeId, clusterId: r.scope.clusterId },
    category: `CREATIVE:${r.category}`,
    reasoning: r.reasoning,
    confidence: confidenceOf(r.confidence),
    risk: normalizeRisk(r.risk),
    dataTrust: r.dataTrust,
    expectedImpact: r.expectedImpact,
    evidenceDetail: { comparability: r.comparability, ...r.evidence },
    historicalContext: r.historicalContext,
    requiresHumanApproval: true,
    status: 'REVIEWABLE',
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
}

export function fromCommerceRecommendation(r: CommerceRecommendation, opts: { id?: string; createdAt?: string } = {}): UnifiedRecommendation {
  return {
    recommendationId: opts.id ?? randomUUID(),
    domain: 'COMMERCE',
    organizationId: r.organizationId,
    scope: { accountId: r.scope.accountId, storeId: r.scope.storeId },
    category: `COMMERCE:${r.category}`,
    reasoning: r.reasoning,
    confidence: confidenceOf(r.confidence),
    risk: normalizeRisk(r.risk),
    dataTrust: r.dataTrust,
    expectedImpact: 'NEGATIVE_RISK_REDUCTION',
    evidenceDetail: r.evidence,
    requiresHumanApproval: true,
    status: 'REVIEWABLE',
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
}

export function fromOptimizationRecommendation(r: OptimizationRecommendation, opts: { id?: string; createdAt?: string } = {}): UnifiedRecommendation {
  return {
    recommendationId: opts.id ?? randomUUID(),
    domain: 'OPTIMIZE',
    organizationId: r.organizationId,
    scope: { accountId: r.scope.accountId, campaignId: r.scope.campaignId, channel: r.scope.channel },
    category: `OPTIMIZE:${r.category}`,
    reasoning: r.reasoning,
    confidence: r.confidence,
    risk: r.risk,
    // Optimization recommendations do not carry a canonical dataTrust; default to the conservative
    // live floor and let the composed-result trust summary cap it against stronger-sourced inputs.
    dataTrust: 'PLATFORM_REPORTED',
    expectedImpact: 'UNCERTAIN',
    evidenceDetail: { comparability: r.comparability, ...r.evidence },
    refs: r.refs,
    requiresHumanApproval: true,
    status: 'REVIEWABLE',
    createdAt: opts.createdAt ?? new Date().toISOString(),
  };
}

const RISK_ORDER: Record<Risk, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
const CONFIDENCE_ORDER: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/**
 * Deterministic product ordering for a recommendation list: highest action-risk first (what could
 * hurt most if ignored), then highest diagnosis confidence, then most recent. Never model-ordered.
 */
export function rankRecommendations(recs: UnifiedRecommendation[]): UnifiedRecommendation[] {
  return [...recs].sort((a, b) =>
    RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
    || CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]
    || b.createdAt.localeCompare(a.createdAt),
  );
}
