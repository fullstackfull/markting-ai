/**
 * Phase 6 — OPTIMIZATION recommendation categories. Review-only typed labels, like every prior phase:
 * no endpoint/path/body, `requiresHumanApproval: true`, never an auto budget/bid/pause/launch. These
 * wrap allocation moves, experiment designs, saturation/marginal findings, etc. for human review.
 */
import type { BiText, Confidence, Risk } from '../intelligence/decision-model';

export const OPTIMIZATION_RECOMMENDATION_CATEGORIES = [
  'BUDGET_REALLOCATION_REVIEW', 'SCALE_REVIEW', 'DOWNSCALE_REVIEW', 'EXPERIMENT_REVIEW',
  'SATURATION_REVIEW', 'MARGINAL_EFFICIENCY_REVIEW', 'CHANNEL_ALLOCATION_REVIEW',
  'PROFIT_OPTIMIZATION_REVIEW', 'INVENTORY_CONSTRAINT_REVIEW', 'PROMOTION_ADJUSTMENT_REVIEW',
] as const;
export type OptimizationRecommendationCategory = (typeof OPTIMIZATION_RECOMMENDATION_CATEGORIES)[number];

export interface OptimizationRecommendation {
  organizationId: string;
  scope: { accountId?: string; campaignId?: string; channel?: string; experimentId?: string };
  category: OptimizationRecommendationCategory;
  reasoning: BiText;
  evidence: Record<string, unknown>;
  confidence: Confidence;
  risk: Risk;
  comparability?: 'COMPARABLE' | 'PARTIALLY_COMPARABLE' | 'NOT_COMPARABLE';
  /** Always true — review only; nothing executes, no budget/bid/pause/launch. */
  requiresHumanApproval: true;
  /** References into the human workbench (scenario id, experiment id) — never an execution endpoint. */
  refs?: { scenarioId?: string; experimentId?: string };
}

export function optimizationRecommendation(input: Omit<OptimizationRecommendation, 'requiresHumanApproval'>): OptimizationRecommendation {
  return { ...input, requiresHumanApproval: true };
}
