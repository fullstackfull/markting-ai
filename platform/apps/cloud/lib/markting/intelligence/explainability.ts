/**
 * Phase 2W — explainability. Every recommendation/diagnosis must be inspectable WITHOUT relying on the
 * natural-language narration: which metric values were used, which periods were compared, which
 * entities, the trust level, the attribution basis, the calculation, and the source. This module
 * produces a machine-readable explanation bundle from the structured evidence that already travels
 * with each artifact — the narration is a view OF this, never the source of truth.
 */
import type { Diagnosis, EvidenceRef, Recommendation } from './decision-model';

export interface ExplanationBundle {
  subject: { kind: 'recommendation' | 'diagnosis'; id?: string; type: string };
  scope: { organizationId: string; accountId: string; entityId: string; entityLevel: string };
  confidence?: string;
  risk?: string;
  dataTrust: string;
  expectedImpact?: string;
  /** Flattened, machine-readable evidence: every number + the calculation that produced it. */
  evidence: Array<{
    kind: EvidenceRef['kind'];
    metric?: string;
    entities: string[];
    periods?: EvidenceRef['periods'];
    values: EvidenceRef['values'];
    currency?: string;
    attributionBasis?: string;
    dataTrust: string;
    calculation: string;
  }>;
  factors?: Diagnosis['factors'];
}

function flatten(evidence: EvidenceRef[]): ExplanationBundle['evidence'] {
  return evidence.map((e) => ({
    kind: e.kind, metric: e.metric, entities: e.entityIds, periods: e.periods, values: e.values,
    currency: e.currency, attributionBasis: e.attributionBasis, dataTrust: e.dataTrust, calculation: e.calculation,
  }));
}

export function explainDiagnosis(d: Diagnosis): ExplanationBundle {
  return {
    subject: { kind: 'diagnosis', type: d.type },
    scope: { organizationId: d.scope.organizationId, accountId: d.scope.accountId, entityId: d.scope.entityId, entityLevel: d.scope.entityLevel },
    confidence: d.confidence, dataTrust: d.dataTrust, evidence: flatten(d.evidence), factors: d.factors,
  };
}

export function explainRecommendation(r: Recommendation): ExplanationBundle {
  return {
    subject: { kind: 'recommendation', id: r.recommendationId, type: `${r.category}/${r.actionType}` },
    scope: { organizationId: r.organizationId, accountId: r.accountId, entityId: r.entityScope.entityId, entityLevel: r.entityScope.entityLevel },
    confidence: r.confidence, risk: r.risk, dataTrust: r.dataTrust, expectedImpact: r.expectedImpact,
    evidence: flatten(r.evidence), factors: r.diagnosis.factors,
  };
}

/** Is this artifact fully explainable (every claim has at least one machine-readable evidence ref)? */
export function isFullyExplainable(bundle: ExplanationBundle): boolean {
  return bundle.evidence.length > 0 && bundle.evidence.every((e) => !!e.calculation && Object.keys(e.values).length > 0);
}
