/**
 * Phase 2A — the canonical media-buyer DECISION MODEL. A recommendation is never free-form model
 * prose: it is a structured, evidence-backed artifact produced deterministically by the diagnostic
 * engine, which the LLM later narrates. Confidence, risk and expected-impact are categorical and
 * derived from data (Phase 2Q/2R/2S), never invented by the model.
 *
 * SAFETY INVARIANT (enforced by construction + tests, see test/phase2-safety.test.ts): a
 * `Recommendation` carries only a TYPED review `category` + `actionType` + an `entityScope`. It has no
 * endpoint, path, HTTP method, or request body — nothing that could become a second write path. The
 * only route to a provider mutation remains the Phase-0 policy-engine preview/apply path, and that is
 * reachable only by a human-approved typed action, never by accepting a recommendation.
 */
import type { CanonicalMetric, EntityLevel } from './model';
import type { DataTier } from '../data-trust';

export interface BiText { en: string; ar: string }

/** Categorical confidence in the DIAGNOSIS (how strongly the evidence supports it). Phase 2Q. */
export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Risk of ACTING on the recommendation (potential consequence). Orthogonal to confidence. Phase 2R. */
export const RISK_LEVELS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const;
export type Risk = (typeof RISK_LEVELS)[number];

/** Expected impact direction — never a fabricated "+23% ROAS". Phase 2S. */
export const EXPECTED_IMPACTS = ['POSITIVE_DIRECTION_EXPECTED', 'NEGATIVE_RISK_REDUCTION', 'UNCERTAIN', 'NOT_ESTIMATED'] as const;
export type ExpectedImpact = (typeof EXPECTED_IMPACTS)[number];

/** Severity shared by diagnoses and findings. */
export const SEVERITIES = ['INFO', 'WATCH', 'ATTENTION', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * A machine-readable reference to the exact data behind a claim (Phase 2W explainability). Every
 * surfaced finding must be reconstructable from these: which metric, which entities, which periods,
 * what trust, what attribution, and the arithmetic that produced the number.
 */
export interface EvidenceRef {
  kind: 'metric_delta' | 'ratio' | 'contribution' | 'pacing' | 'funnel_stage' | 'anomaly' | 'trust_gate' | 'target_gap' | 'forecast';
  metric?: CanonicalMetric;
  /** Canonical entity ids involved (namespaced provider:account:raw). */
  entityIds: string[];
  entityLevel?: EntityLevel;
  /** Periods compared, when the evidence is period-over-period. */
  periods?: { current?: { start: string; end: string }; previous?: { start: string; end: string } };
  /** The raw values that produced the claim (from/to/share/rate/etc.). */
  values: Record<string, number | string | boolean | null>;
  currency?: string;
  attributionBasis?: string;
  dataTrust: DataTier;
  /** A short, deterministic description of the calculation (not model prose). */
  calculation: string;
}

/** A detected movement in one metric for one scope — the raw input a diagnosis reasons over. */
export interface Signal {
  metric: CanonicalMetric;
  entityId: string;
  entityLevel: EntityLevel;
  direction: 'up' | 'down' | 'flat';
  from: number;
  to: number;
  pct?: number;
  material: boolean;
  evidence: EvidenceRef;
}

/** Diagnosis types the Phase 2B engine can emit. Add only when the evidence to support it exists. */
export const DIAGNOSIS_TYPES = [
  'SPEND_INCREASE', 'SPEND_DECREASE', 'UNDERDELIVERY', 'OVERSPEND_VS_PACING',
  'CONVERSION_VOLUME_DECLINE', 'CONVERSION_VOLUME_INCREASE', 'CONVERSION_RATE_DECLINE',
  'CPA_DETERIORATION', 'CPA_IMPROVEMENT', 'ROAS_DETERIORATION', 'ROAS_IMPROVEMENT',
  'CTR_DETERIORATION', 'CTR_IMPROVEMENT', 'CPM_PRESSURE', 'CPC_PRESSURE',
  'FREQUENCY_PRESSURE', 'FUNNEL_STAGE_COLLAPSE', 'ANOMALY', 'DATA_QUALITY_ISSUE',
  'TARGET_MISS', 'TARGET_BEAT', 'INSUFFICIENT_EVIDENCE',
] as const;
export type DiagnosisType = (typeof DIAGNOSIS_TYPES)[number];

export interface Diagnosis {
  type: DiagnosisType;
  /** The entity the diagnosis is about. */
  scope: { organizationId: string; accountId: string; entityId: string; entityLevel: EntityLevel };
  severity: Severity;
  /** Human-facing bilingual summary derived from the structured fields (filled by the engine, not the LLM). */
  summary: BiText;
  evidence: EvidenceRef[];
  confidence: Confidence;
  dataTrust: DataTier;
  /** Optional decomposition (e.g. CPA move attributed to CTR vs CPM), when evidence allows. */
  factors?: Array<{ factor: string; metric?: CanonicalMetric; sharePct?: number; note?: BiText }>;
}

/** Typed review categories (Phase 2P). A recommendation names exactly one. */
export const RECOMMENDATION_CATEGORIES = [
  'BUDGET_REVIEW', 'PAUSE_REVIEW', 'DELIVERY_REVIEW', 'TRACKING_REVIEW',
  'CREATIVE_REVIEW', 'TARGET_REVIEW', 'FUNNEL_REVIEW', 'ANOMALY_REVIEW', 'DATA_QUALITY_REVIEW',
] as const;
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

/**
 * A TYPED review intent. This is deliberately NOT a provider call: it is a label a human reviews.
 * It maps (later, on the Phase-0 path, under human approval) to a typed provider action — it never
 * carries the action's parameters, endpoint, or body.
 */
export const REVIEW_ACTION_TYPES = [
  'REVIEW_BUDGET_SCALE', 'REVIEW_BUDGET_REDUCE', 'REVIEW_PAUSE', 'REVIEW_DELIVERY',
  'REVIEW_TRACKING', 'REVIEW_CREATIVE_REFRESH', 'REVIEW_TARGET_SETTING', 'REVIEW_FUNNEL',
  'INVESTIGATE_ANOMALY', 'INVESTIGATE_DATA_QUALITY', 'NO_ACTION',
] as const;
export type ReviewActionType = (typeof REVIEW_ACTION_TYPES)[number];

export const RECOMMENDATION_STATUSES = [
  'DRAFT', 'REVIEWABLE', 'INSUFFICIENT_EVIDENCE', 'DISMISSED', 'ACCEPTED_FOR_PREVIEW', 'EXPIRED',
] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface Recommendation {
  recommendationId: string;
  organizationId: string;
  accountId: string;
  entityScope: { entityId: string; entityLevel: EntityLevel; name: string };
  category: RecommendationCategory;
  /** Typed review intent only — never an endpoint/path/body (safety invariant). */
  actionType: ReviewActionType;
  /** The diagnosis this recommendation rests on. */
  diagnosis: Diagnosis;
  /** Structured, deterministic reasoning (bilingual); the LLM may re-narrate but not alter the facts. */
  reasoning: BiText;
  evidence: EvidenceRef[];
  confidence: Confidence;
  risk: Risk;
  dataTrust: DataTier;
  expectedImpact: ExpectedImpact;
  /** At least one considered alternative (incl. "do nothing / keep observing"). */
  alternatives: Array<{ actionType: ReviewActionType; rationale: BiText }>;
  /** Always true in Phase 2 — nothing here executes without a human on the Phase-0 path. */
  requiresHumanApproval: true;
  status: RecommendationStatus;
  /** Recommendations expire so stale advice is never actioned as current. ISO timestamp. */
  expiresAt: string;
  createdAt: string;
}

/** Health (Phase 2D) — explicit dimensions, no fake single score. */
export const HEALTH_STATES = ['HEALTHY', 'WATCH', 'ATTENTION', 'CRITICAL', 'INSUFFICIENT_DATA'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
export const HEALTH_DIMENSIONS = ['delivery', 'efficiency', 'conversion_quality', 'pacing', 'data_sufficiency', 'creative_freshness', 'tracking_quality', 'attribution_confidence'] as const;
export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number];

/** Scaling readiness (Phase 2F). No automatic percentage increases. */
export const SCALING_STATES = ['NOT_EVALUABLE', 'NOT_READY', 'POTENTIALLY_READY', 'READY_FOR_HUMAN_REVIEW'] as const;
export type ScalingState = (typeof SCALING_STATES)[number];

/** Downscale / pause candidacy (Phase 2G). Never executes. */
export const DOWNSCALE_STATES = ['OBSERVE', 'REVIEW', 'STRONG_REVIEW_CANDIDATE'] as const;
export type DownscaleState = (typeof DOWNSCALE_STATES)[number];

/** Trend classification (Phase 2I). */
export const TREND_STATES = ['NOISE', 'SHORT_TERM_MOVE', 'PERSISTENT_TREND', 'STRUCTURAL_SHIFT'] as const;
export type TrendState = (typeof TREND_STATES)[number];

/** Anomaly classification (Phase 2H). Only CRITICAL for genuinely abnormal, business-relevant change. */
export const ANOMALY_CLASSES = ['INFO', 'WATCH', 'ACTIONABLE', 'CRITICAL'] as const;
export type AnomalyClass = (typeof ANOMALY_CLASSES)[number];

/** Comparability (Phase 2O). */
export const COMPARABILITY_STATES = ['COMPARABLE', 'PARTIALLY_COMPARABLE', 'NOT_COMPARABLE'] as const;
export type Comparability = (typeof COMPARABILITY_STATES)[number];

/** Confidence math: rank helpers so the lowest contributing factor caps the whole (never averages up). */
export const CONFIDENCE_RANK: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
export function minConfidence(...cs: Confidence[]): Confidence {
  return cs.reduce<Confidence>((lo, c) => (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[lo] ? c : lo), 'HIGH');
}
export const RISK_RANK: Record<Risk, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
export function maxRisk(...rs: Risk[]): Risk {
  return rs.reduce<Risk>((hi, r) => (RISK_RANK[r] > RISK_RANK[hi] ? r : hi), 'LOW');
}
