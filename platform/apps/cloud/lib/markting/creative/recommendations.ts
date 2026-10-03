/**
 * Phase 4R/4S — creative REVIEW recommendations and structured test IDEAS. Review-only: like Phase 2,
 * a recommendation is a typed review label carrying no endpoint/path/body — it can never publish,
 * replace, or modify a creative. Test ideas are explicitly labelled HYPOTHESIS, not a proven strategy,
 * and are never launched. Each item carries evidence, confidence, risk, trust, scope, comparability,
 * and expected direction (direction only, never a fabricated number).
 */
import type { BiText } from '../intelligence/decision-model';
import type { DataTier } from '../data-trust';
import type { Comparability } from './performance';
import type { FatigueResult } from './fatigue';

export const CREATIVE_RECOMMENDATION_CATEGORIES = [
  'CREATIVE_REFRESH_REVIEW', 'CREATIVE_FATIGUE_REVIEW', 'HOOK_TEST_REVIEW', 'ANGLE_TEST_REVIEW',
  'FORMAT_TEST_REVIEW', 'CTA_TEST_REVIEW', 'CREATIVE_CONCENTRATION_REVIEW', 'UNDERPERFORMER_REVIEW',
] as const;
export type CreativeRecommendationCategory = (typeof CREATIVE_RECOMMENDATION_CATEGORIES)[number];

export interface CreativeRecommendation {
  organizationId: string;
  accountId: string;
  scope: { creativeId?: string; clusterId?: string; campaignId?: string };
  category: CreativeRecommendationCategory;
  reasoning: BiText;
  evidence: Record<string, unknown>;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  risk: 'LOW' | 'MODERATE' | 'HIGH';
  dataTrust: DataTier;
  comparability: Comparability;
  expectedImpact: 'POSITIVE_DIRECTION_EXPECTED' | 'NEGATIVE_RISK_REDUCTION' | 'UNCERTAIN' | 'NOT_ESTIMATED';
  /** Always true — review only; nothing here executes. */
  requiresHumanApproval: true;
  /** Optional historical context (from creative memory), clearly labelled as historical. */
  historicalContext?: BiText;
}

export interface CreativeRecoInput {
  organizationId: string;
  accountId: string;
  creativeId?: string;
  clusterId?: string;
  dataTrust: DataTier;
  comparability?: Comparability;
  fatigue?: FatigueResult;
  rating?: 'PROMISING' | 'STRONG_PERFORMER' | 'AVERAGE' | 'UNDERPERFORMING' | 'INSUFFICIENT_DATA';
  concentrationSpendShare?: number;
  historicalContext?: BiText;
}

export function generateCreativeRecommendations(input: CreativeRecoInput): CreativeRecommendation[] {
  const recs: CreativeRecommendation[] = [];
  const base = { organizationId: input.organizationId, accountId: input.accountId, scope: { creativeId: input.creativeId, clusterId: input.clusterId }, dataTrust: input.dataTrust, comparability: input.comparability ?? 'PARTIALLY_COMPARABLE', requiresHumanApproval: true as const, historicalContext: input.historicalContext };

  // Fatigue → fatigue/refresh review (only on a real signal; WATCH does not auto-recommend).
  if (input.fatigue && (input.fatigue.state === 'FATIGUE_SIGNAL' || input.fatigue.state === 'STRONG_FATIGUE_SIGNAL')) {
    recs.push({ ...base, category: 'CREATIVE_FATIGUE_REVIEW', confidence: input.fatigue.confidence, risk: 'MODERATE', expectedImpact: 'NEGATIVE_RISK_REDUCTION',
      reasoning: { en: `Fatigue signal (${input.fatigue.state}, not proven) — review this creative and consider a refresh test.`, ar: `إشارة إجهاد (${input.fatigue.state}، غير مثبتة) — راجع هذا الإعلان وفكّر في اختبار تجديد.` },
      evidence: { signals: input.fatigue.signals.filter((s) => s.present).map((s) => s.kind) } });
  }
  // Underperformer (never on INSUFFICIENT_DATA).
  if (input.rating === 'UNDERPERFORMING') {
    recs.push({ ...base, category: 'UNDERPERFORMER_REVIEW', confidence: 'MEDIUM', risk: 'MODERATE', expectedImpact: 'NEGATIVE_RISK_REDUCTION',
      reasoning: { en: 'Underperforming vs comparable creatives — review before it absorbs more budget.', ar: 'أداء ضعيف مقارنة بإعلانات مماثلة — راجعه قبل أن يستهلك المزيد من الميزانية.' }, evidence: { rating: input.rating } });
  }
  // Spend concentration.
  if ((input.concentrationSpendShare ?? 0) >= 60) {
    recs.push({ ...base, category: 'CREATIVE_CONCENTRATION_REVIEW', confidence: 'MEDIUM', risk: 'LOW', expectedImpact: 'NEGATIVE_RISK_REDUCTION',
      reasoning: { en: `Spend is concentrated (${input.concentrationSpendShare}%) in this creative/cluster — single-point risk; review diversification.`, ar: `الإنفاق مُركّز (${input.concentrationSpendShare}%) في هذا الإعلان/العنقود — مخاطرة نقطة واحدة؛ راجع التنويع.` }, evidence: { spendShare: input.concentrationSpendShare } });
  }
  return recs;
}

// ---- Test ideas (4S) — HYPOTHESIS only, never launched ----
export interface CreativeTestIdea {
  kind: 'HYPOTHESIS';
  hypothesis: BiText;
  controlIdea: BiText;
  treatmentIdea: BiText;
  primaryMetric: string;
  guardrailMetrics: string[];
  requiredEvidence: BiText;
  minObservationGuidance: BiText;
}

/** Generate a test idea from an observed pattern. Clearly a hypothesis; does NOT launch anything. */
export function creativeTestIdea(input: { decliningPattern: string; promisingPattern: string; primaryMetric?: string }): CreativeTestIdea {
  return {
    kind: 'HYPOTHESIS',
    hypothesis: { en: `If the ${input.decliningPattern} cluster is tiring while the ${input.promisingPattern} cluster shows better early CTR, a new ${input.promisingPattern} variant MAY perform better — unproven.`, ar: `إذا كان عنقود ${input.decliningPattern} يُجهَد بينما يُظهر عنقود ${input.promisingPattern} معدّل نقر أفضل مبكرًا، فقد يؤدّي متغيّر ${input.promisingPattern} الجديد أداءً أفضل — غير مثبت.` },
    controlIdea: { en: `Keep the current ${input.decliningPattern} creatives running as control.`, ar: `إبقاء إعلانات ${input.decliningPattern} الحالية كمجموعة ضبط.` },
    treatmentIdea: { en: `Launch a new ${input.promisingPattern} creative variant as treatment.`, ar: `إطلاق متغيّر إعلان ${input.promisingPattern} جديد كمجموعة معالجة.` },
    primaryMetric: input.primaryMetric ?? 'cpa',
    guardrailMetrics: ['spend', 'roas', 'conversions'],
    requiredEvidence: { en: 'Comparable audience/objective/attribution; enough conversions per arm to read the primary metric.', ar: 'جمهور/هدف/إسناد قابل للمقارنة؛ تحويلات كافية لكل مجموعة لقراءة المقياس الأساسي.' },
    minObservationGuidance: { en: 'Observe at least one full conversion cycle before reading; do not stop early on noise.', ar: 'راقب دورة تحويل كاملة على الأقل قبل القراءة؛ لا توقف مبكرًا بسبب التشويش.' },
  };
}
