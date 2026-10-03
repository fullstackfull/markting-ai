/**
 * Phase 2P — deterministic recommendation generation. A recommendation is assembled from a diagnosis
 * (the evidence), a typed review category + action, a confidence (from the diagnosis), an action risk
 * (Phase 2R), an expected-impact direction (Phase 2S), at least one alternative, an expiry, and a
 * status. It NEVER carries an endpoint/path/body (safety invariant) and ALWAYS requiresHumanApproval.
 * Accepting a recommendation does not mutate anything — it only moves it to ACCEPTED_FOR_PREVIEW; a
 * provider change still requires the Phase-0 human-approved preview/apply path.
 */
import { randomUUID } from 'node:crypto';
import { classifyRisk } from './risk';
import { expectedImpactFor } from './impact';
import type {
  BiText, Diagnosis, DiagnosisType, Recommendation, RecommendationCategory, ReviewActionType,
} from './decision-model';
import type { ScalingResult, DownscaleResult } from './scaling';

export interface RecommendationFacts {
  spend: number;
  conversions: number;
  accountSpendShare?: number;
  strategicallyImportant?: boolean;
}

export interface GenerateInput {
  organizationId: string;
  entity: { entityId: string; entityLevel: Recommendation['entityScope']['entityLevel']; name: string; accountId: string };
  diagnoses: Diagnosis[];
  facts: RecommendationFacts;
  scaling?: ScalingResult;
  downscale?: DownscaleResult;
  now?: number;
  ttlDays?: number;
  idFactory?: () => string;
}

/** Map a diagnosis to a typed review category + action, using the dominant factor where relevant. */
function mapDiagnosis(d: Diagnosis): { category: RecommendationCategory; actionType: ReviewActionType } | null {
  const dominant = d.factors && d.factors.length ? [...d.factors].sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0))[0]!.factor : undefined;
  const byFactor = (): { category: RecommendationCategory; actionType: ReviewActionType } => {
    switch (dominant) {
      case 'click_through': return { category: 'CREATIVE_REVIEW', actionType: 'REVIEW_CREATIVE_REFRESH' };
      case 'conversion_rate': return { category: 'FUNNEL_REVIEW', actionType: 'REVIEW_FUNNEL' };
      case 'media_cost': return { category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY' };
      default: return { category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY' };
    }
  };
  const M: Partial<Record<DiagnosisType, { category: RecommendationCategory; actionType: ReviewActionType }>> = {
    INSUFFICIENT_EVIDENCE: { category: 'DATA_QUALITY_REVIEW', actionType: 'NO_ACTION' },
    DATA_QUALITY_ISSUE: { category: 'DATA_QUALITY_REVIEW', actionType: 'INVESTIGATE_DATA_QUALITY' },
    CTR_DETERIORATION: { category: 'CREATIVE_REVIEW', actionType: 'REVIEW_CREATIVE_REFRESH' },
    CPM_PRESSURE: { category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY' },
    CPC_PRESSURE: { category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY' },
    CONVERSION_RATE_DECLINE: { category: 'FUNNEL_REVIEW', actionType: 'REVIEW_FUNNEL' },
    CONVERSION_VOLUME_DECLINE: { category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY' },
    FUNNEL_STAGE_COLLAPSE: { category: 'FUNNEL_REVIEW', actionType: 'REVIEW_FUNNEL' },
    OVERSPEND_VS_PACING: { category: 'BUDGET_REVIEW', actionType: 'REVIEW_BUDGET_REDUCE' },
    UNDERDELIVERY: { category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY' },
    FREQUENCY_PRESSURE: { category: 'CREATIVE_REVIEW', actionType: 'REVIEW_CREATIVE_REFRESH' },
    ANOMALY: { category: 'ANOMALY_REVIEW', actionType: 'INVESTIGATE_ANOMALY' },
    TARGET_MISS: { category: 'TARGET_REVIEW', actionType: 'REVIEW_TARGET_SETTING' },
  };
  if (d.type === 'CPA_DETERIORATION' || d.type === 'ROAS_DETERIORATION') return byFactor();
  // Tracking red flag (spend with zero conversions) → tracking review specifically.
  if (d.type === 'DATA_QUALITY_ISSUE' && d.severity === 'CRITICAL') return { category: 'TRACKING_REVIEW', actionType: 'REVIEW_TRACKING' };
  return M[d.type] ?? null; // improvements / non-reviewable diagnoses produce no recommendation here
}

export function generateRecommendations(input: GenerateInput): Recommendation[] {
  const now = input.now ?? Date.now();
  const ttl = (input.ttlDays ?? 3) * 86_400_000;
  const id = input.idFactory ?? (() => `rec_${randomUUID()}`);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttl).toISOString();
  const recs: Recommendation[] = [];
  const seen = new Set<string>();

  for (const d of input.diagnoses) {
    const mapped = mapDiagnosis(d);
    if (!mapped) continue;
    const key = `${mapped.category}:${mapped.actionType}`;
    if (seen.has(key)) continue; // one recommendation per category/action per entity (avoid storms)
    seen.add(key);

    const { risk } = classifyRisk({ actionType: mapped.actionType, spend: input.facts.spend, conversions: input.facts.conversions, accountSpendShare: input.facts.accountSpendShare, strategicallyImportant: input.facts.strategicallyImportant });
    const status = d.type === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' : d.confidence === 'LOW' ? 'DRAFT' : 'REVIEWABLE';
    recs.push({
      recommendationId: id(),
      organizationId: input.organizationId,
      accountId: input.entity.accountId,
      entityScope: { entityId: input.entity.entityId, entityLevel: input.entity.entityLevel, name: input.entity.name },
      category: mapped.category,
      actionType: mapped.actionType,
      diagnosis: d,
      reasoning: d.summary,
      evidence: d.evidence,
      confidence: d.confidence,
      risk,
      dataTrust: d.dataTrust,
      expectedImpact: expectedImpactFor(d.type, mapped.actionType),
      alternatives: altsFor(mapped.actionType),
      requiresHumanApproval: true,
      status,
      expiresAt,
      createdAt,
    });
  }

  // Opportunity: a scaling-ready entity becomes a BUDGET_REVIEW (scale) recommendation (not auto-scale).
  if (input.scaling?.state === 'READY_FOR_HUMAN_REVIEW' && !seen.has('BUDGET_REVIEW:REVIEW_BUDGET_SCALE')) {
    const { risk } = classifyRisk({ actionType: 'REVIEW_BUDGET_SCALE', spend: input.facts.spend, conversions: input.facts.conversions, accountSpendShare: input.facts.accountSpendShare, strategicallyImportant: input.facts.strategicallyImportant });
    const d = input.diagnoses.find((x) => x.type === 'ROAS_IMPROVEMENT' || x.type === 'CPA_IMPROVEMENT') ?? input.diagnoses[0];
    if (d) recs.push(oppRec(input, id(), 'BUDGET_REVIEW', 'REVIEW_BUDGET_SCALE', d, risk, { en: 'Meets scaling criteria — a human should review a budget increase.', ar: 'يستوفي معايير التوسيع — ينبغي لمراجع بشري النظر في زيادة الميزانية.' }, createdAt, expiresAt, 'POSITIVE_DIRECTION_EXPECTED'));
  }
  // A strong downscale candidate becomes a PAUSE_REVIEW (not auto-pause).
  if (input.downscale?.state === 'STRONG_REVIEW_CANDIDATE' && !seen.has('PAUSE_REVIEW:REVIEW_PAUSE')) {
    const { risk } = classifyRisk({ actionType: 'REVIEW_PAUSE', spend: input.facts.spend, conversions: input.facts.conversions, accountSpendShare: input.facts.accountSpendShare, strategicallyImportant: input.facts.strategicallyImportant });
    const d = input.diagnoses[0];
    if (d) recs.push(oppRec(input, id(), 'PAUSE_REVIEW', 'REVIEW_PAUSE', d, risk, { en: 'Strong candidate for pause review — evidence suggests weak performance over a sufficient window.', ar: 'مرشّح قوي لمراجعة الإيقاف — تشير الأدلة إلى أداء ضعيف خلال فترة كافية.' }, createdAt, expiresAt, 'NEGATIVE_RISK_REDUCTION'));
  }

  return recs;
}

function oppRec(input: GenerateInput, recId: string, category: RecommendationCategory, actionType: ReviewActionType, d: Diagnosis, risk: Recommendation['risk'], reasoning: BiText, createdAt: string, expiresAt: string, impact: Recommendation['expectedImpact']): Recommendation {
  return {
    recommendationId: recId, organizationId: input.organizationId, accountId: input.entity.accountId,
    entityScope: { entityId: input.entity.entityId, entityLevel: input.entity.entityLevel, name: input.entity.name },
    category, actionType, diagnosis: d, reasoning, evidence: d.evidence, confidence: d.confidence, risk,
    dataTrust: d.dataTrust, expectedImpact: impact, alternatives: altsFor(actionType), requiresHumanApproval: true,
    status: d.confidence === 'LOW' ? 'DRAFT' : 'REVIEWABLE', expiresAt, createdAt,
  };
}

/** Every recommendation offers at least a "keep observing" alternative plus one action-specific one. */
function altsFor(actionType: ReviewActionType): Recommendation['alternatives'] {
  const observe = { actionType: 'NO_ACTION' as ReviewActionType, rationale: { en: 'Keep observing — gather more evidence before acting.', ar: 'الاستمرار في المراقبة — جمع مزيد من الأدلة قبل التصرّف.' } };
  const alt: Partial<Record<ReviewActionType, { actionType: ReviewActionType; rationale: BiText }>> = {
    REVIEW_BUDGET_SCALE: { actionType: 'NO_ACTION', rationale: { en: 'Hold budget until another stable period confirms readiness.', ar: 'تثبيت الميزانية حتى تؤكد فترة مستقرة أخرى الجاهزية.' } },
    REVIEW_PAUSE: { actionType: 'REVIEW_BUDGET_REDUCE', rationale: { en: 'Reduce budget first instead of a full pause.', ar: 'خفض الميزانية أولًا بدلًا من الإيقاف الكامل.' } },
    REVIEW_CREATIVE_REFRESH: { actionType: 'REVIEW_DELIVERY', rationale: { en: 'Check delivery/placement before refreshing creative.', ar: 'فحص التسليم/المواضع قبل تجديد الإعلان.' } },
  };
  const specific = alt[actionType];
  return specific && specific.actionType !== observe.actionType ? [specific, observe] : [observe];
}
