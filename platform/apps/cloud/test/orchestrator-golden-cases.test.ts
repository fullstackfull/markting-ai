import { describe, expect, it } from 'vitest';
import { orchestrator, type OrchestratorInput } from '@/lib/markting/orchestrator/orchestrator';
import type { IntelligenceRequestContext } from '@/lib/markting/orchestrator/context';
import type { Diagnosis } from '@/lib/markting/intelligence/decision-model';
import type { CommerceDiagnosis } from '@/lib/markting/commerce/diagnostics';
import type { CreativeRecommendation } from '@/lib/markting/creative/recommendations';

/**
 * Coherence Program 23 — cross-domain golden cases. Each asserts the WHOLE orchestrator composition
 * (diagnosis + ranking + next action + availability), not a single engine function. Deterministic.
 */
const ctx = (over: Partial<IntelligenceRequestContext> = {}): IntelligenceRequestContext => ({
  organizationId: 'org-1', userId: 'u-1', permissions: ['owner'], runtimeMode: 'LIVE_RECOMMENDATIONS',
  accountId: 'google:acc:1', provider: 'google', reportingCurrency: 'SAR', ...over,
});
const media = (type: Diagnosis['type'], severity: Diagnosis['severity'], factors?: Diagnosis['factors']): Diagnosis => ({
  type, scope: { organizationId: 'org-1', accountId: 'google:acc:1', entityId: 'c1', entityLevel: 'campaign' },
  severity, summary: { en: `${type}`, ar: `${type}` }, evidence: [], confidence: 'MEDIUM', dataTrust: 'PLATFORM_REPORTED', factors,
});
const commerce = (type: CommerceDiagnosis['type'], severity: CommerceDiagnosis['severity']): CommerceDiagnosis => ({
  type, severity, summary: { en: `${type}`, ar: `${type}` }, evidence: {},
});
const fatigue: CreativeRecommendation = {
  organizationId: 'org-1', accountId: 'google:acc:1', scope: { clusterId: 'cl1' }, category: 'CREATIVE_FATIGUE_REVIEW',
  reasoning: { en: 'fatigue', ar: 'إجهاد' }, evidence: {}, confidence: 'MEDIUM', risk: 'MODERATE',
  dataTrust: 'PLATFORM_REPORTED', comparability: 'PARTIALLY_COMPARABLE', expectedImpact: 'NEGATIVE_RISK_REDUCTION', requiresHumanApproval: true,
};
const compose = (input: Partial<OrchestratorInput>) => orchestrator.compose({ context: ctx(), intent: 'PROFITABILITY_DECLINE', ...input });

describe('Program 23 — cross-domain golden cases', () => {
  it('1. CPM-driven CPA rise is media, not creative (factor dominant = media_cost)', () => {
    const r = compose({ media: { diagnoses: [media('CPM_PRESSURE', 'ATTENTION')] } });
    expect(r.diagnosis.factors[0]!.domain).toBe('MEDIA');
    expect(r.nextAction).toBe('REVIEW');
  });
  it('2. creative fatigue + refunds both worsen profit → both appear, commerce ranks via materiality', () => {
    const r = compose({
      commerce: { diagnoses: [commerce('REFUNDS_ERODE_NET_REVENUE', 'MATERIAL')] },
      creative: { recommendations: [fatigue] },
      materiality: { 'COMMERCE:REFUNDS_ERODE_NET_REVENUE': 0.7 },
    });
    expect(r.diagnosis.factors[0]!.domain).toBe('COMMERCE');
    expect(r.diagnosis.factors.some((f) => f.domain === 'CREATIVE')).toBe(true);
  });
  it('3. platform ROAS up but merchant profit down → commerce drives the story', () => {
    const r = compose({ commerce: { diagnoses: [commerce('REVENUE_UP_PROFIT_DOWN', 'MATERIAL'), commerce('PLATFORM_ROAS_EXCEEDS_MERCHANT', 'MATERIAL')] } });
    expect(r.diagnosis.factors[0]!.domain).toBe('COMMERCE');
    expect(r.diagnosis.headline.en).toContain('merchant-side');
  });
  it('4. data-quality/reconciliation gaps route to INVESTIGATE, not REVIEW', () => {
    const r = compose({ commerce: { diagnoses: [commerce('COMMERCE_DATA_GAPS', 'WATCH')] } });
    expect(r.nextAction).toBe('INVESTIGATE');
    expect(r.diagnosis.unresolved.length).toBeGreaterThan(0);
  });
  it('5. insufficient media evidence is surfaced as a caveat and excluded from factors', () => {
    const r = compose({ media: { diagnoses: [media('INSUFFICIENT_EVIDENCE', 'INFO')] } });
    expect(r.diagnosis.factors).toEqual([]);
    expect(r.nextAction).toBe('MONITOR'); // a signal exists, but nothing diagnosable
  });
  it('6. nothing connected → INSUFFICIENT_EVIDENCE with honest availability', () => {
    const r = compose({ availability: { MEDIA: 'NOT_CONNECTED', COMMERCE: 'NOT_CONNECTED' } });
    expect(r.nextAction).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.domains.find((d) => d.domain === 'COMMERCE')!.state).toBe('NOT_CONNECTED');
  });
  it('7. critical media severity escalates to ATTENTION above a material-commerce ATTENTION', () => {
    const r = compose({
      media: { diagnoses: [media('ROAS_DETERIORATION', 'CRITICAL')] },
      commerce: { diagnoses: [commerce('MER_BELOW_TARGET', 'MATERIAL')] },
    });
    expect(r.diagnosis.factors[0]!.severity).toBe('CRITICAL');
    expect(r.nextAction).toBe('ATTENTION');
  });
  it('8. trust is capped by the weakest contributing source', () => {
    const weak = media('CPA_DETERIORATION', 'WATCH');
    weak.dataTrust = 'UNVERIFIED';
    const r = compose({ media: { diagnoses: [media('ROAS_DETERIORATION', 'ATTENTION'), weak] } });
    expect(r.trust.tier).toBe('UNVERIFIED');
  });
  it('9. a brand/strategic-only account with no deterioration → MONITOR, no false recommendation', () => {
    const r = compose({ media: { diagnoses: [media('SPEND_INCREASE', 'INFO')] } });
    expect(['MONITOR']).toContain(r.nextAction);
    expect(r.recommendations).toEqual([]);
  });
  it('10. ranking is deterministic and stable across input order', () => {
    const a = compose({ commerce: { diagnoses: [commerce('REFUNDS_ERODE_NET_REVENUE', 'MATERIAL'), commerce('MER_BELOW_TARGET', 'WATCH')] } });
    const b = compose({ commerce: { diagnoses: [commerce('MER_BELOW_TARGET', 'WATCH'), commerce('REFUNDS_ERODE_NET_REVENUE', 'MATERIAL')] } });
    expect(a.diagnosis.factors.map((f) => f.key)).toEqual(b.diagnosis.factors.map((f) => f.key));
  });
  it('11. creative-only signal yields a CREATIVE factor and a MONITOR/REVIEW posture', () => {
    const r = compose({ creative: { recommendations: [fatigue] } });
    expect(r.diagnosis.factors[0]!.domain).toBe('CREATIVE');
    expect(['MONITOR', 'REVIEW']).toContain(r.nextAction);
  });
  it('12. every surfaced recommendation is review-only (no execution affordance)', () => {
    const r = compose({
      media: { diagnoses: [media('CPA_DETERIORATION', 'ATTENTION', [{ factor: 'click_through', sharePct: 80 }])] },
      creative: { recommendations: [fatigue] },
    });
    expect(r.recommendations.every((x) => x.requiresHumanApproval === true)).toBe(true);
  });
});
