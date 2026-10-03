/**
 * Phase 2R — risk classification. Risk is the potential CONSEQUENCE of acting on a recommendation; it
 * is orthogonal to confidence (how strongly evidence supports the diagnosis). A high-confidence
 * diagnosis can still carry high action risk (e.g. pausing a high-spend converting campaign). Risk
 * rises with the money at stake and the reversibility/blast-radius of the implied action.
 */
import { maxRisk, type ReviewActionType, type Risk } from './decision-model';

export interface RiskInput {
  actionType: ReviewActionType;
  /** Period spend on the entity (exposure). */
  spend: number;
  /** Conversions currently produced (what could be lost by pausing/cutting). */
  conversions: number;
  /** Fraction of account spend this entity represents (blast radius), 0..1. */
  accountSpendShare?: number;
  /** Entity is configured as strategically important. */
  strategicallyImportant?: boolean;
}

/** Base action risk — investigations are safe; pauses/cuts/scales move real money. */
const BASE_ACTION_RISK: Record<ReviewActionType, Risk> = {
  NO_ACTION: 'LOW',
  INVESTIGATE_ANOMALY: 'LOW',
  INVESTIGATE_DATA_QUALITY: 'LOW',
  REVIEW_TRACKING: 'LOW',
  REVIEW_TARGET_SETTING: 'LOW',
  REVIEW_FUNNEL: 'MODERATE',
  REVIEW_CREATIVE_REFRESH: 'MODERATE',
  REVIEW_DELIVERY: 'MODERATE',
  REVIEW_BUDGET_REDUCE: 'MODERATE',
  REVIEW_BUDGET_SCALE: 'HIGH', // deploying more money is inherently riskier
  REVIEW_PAUSE: 'HIGH',        // stopping delivery can forfeit conversions
};

export function classifyRisk(input: RiskInput): { risk: Risk; reasons: string[] } {
  const reasons: string[] = [];
  let risk = BASE_ACTION_RISK[input.actionType];
  reasons.push(`base risk for ${input.actionType} is ${risk}`);

  // Pausing/cutting a campaign that is actively converting risks losing those conversions.
  if ((input.actionType === 'REVIEW_PAUSE' || input.actionType === 'REVIEW_BUDGET_REDUCE') && input.conversions > 0) {
    risk = maxRisk(risk, 'HIGH');
    reasons.push('entity is actively converting — reducing/pausing risks lost conversions');
  }
  // Large blast radius escalates.
  if ((input.accountSpendShare ?? 0) >= 0.4 && input.actionType !== 'NO_ACTION') {
    risk = maxRisk(risk, 'HIGH');
    reasons.push('entity is a large share of account spend — high blast radius');
  }
  // Scaling or pausing a strategically important, high-spend entity is CRITICAL to get wrong.
  if (input.strategicallyImportant && (input.actionType === 'REVIEW_PAUSE' || input.actionType === 'REVIEW_BUDGET_SCALE') && input.spend > 0) {
    risk = maxRisk(risk, 'CRITICAL');
    reasons.push('strategically important entity — acting wrongly is critical');
  }
  return { risk, reasons };
}
