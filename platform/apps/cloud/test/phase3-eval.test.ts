import { describe, expect, it } from 'vitest';
import { evaluateOutcome, type OutcomeInput, type OutcomeSnapshot } from '@/lib/markting/outcomes';
import { evaluateWritePolicy, isActive, memoryWriteSchema } from '@/lib/markting/memory';
import { retrieveMemory } from '@/lib/markting/memory-retrieval';
import { buildEffectivenessLedger, calibrateConfidence, type LedgerRow } from '@/lib/markting/learning';
import { changePointContext } from '@/lib/markting/timeline';
import { answerDecisionQuestion } from '@/lib/markting/decision-aware-ask';
import type { MemoryItem } from '@/lib/markting/memory';

/**
 * AI EVALUATION 3.0 — memory + outcome reasoning. Scored for factual accuracy, provenance, temporal
 * accuracy, uncertainty, CAUSAL RESTRAINT, tenant isolation, memory trust, non-poisoning, language.
 */
function snap(o: Partial<OutcomeSnapshot> = {}): OutcomeSnapshot {
  return { entityId: 'meta:act_1:c1', entityLevel: 'campaign', accountId: 'act_1', window: { start: '2026-09-08', end: '2026-09-14' }, currency: 'SAR', attributionBasis: '7d', trust: 'PLATFORM_REPORTED', complete: true, sampleSize: 60, metrics: {}, ...o };
}
function oi(o: Partial<OutcomeInput> = {}): OutcomeInput {
  return { recommendationId: 'r', category: 'CREATIVE_REVIEW', windowLabel: '7d', before: snap({ window: { start: '2026-09-01', end: '2026-09-07' }, metrics: { ctr: 2 } }), after: snap({ metrics: { ctr: 3 } }), ...o };
}
const mem = (over: Partial<MemoryItem> = {}): MemoryItem => ({ organizationId: 'o', category: 'human_preference', key: 'risk_tolerance', value: 'low', source: 'human_config', trust: 'EXPLICIT_HUMAN', explicit: true, createdAt: new Date().toISOString(), ...over });

describe('AI Evaluation 3.0 — 20 memory/outcome scenarios', () => {
  it('1. accepted recommendation with positive aligned outcome — aligned, not caused', () => {
    const r = evaluateOutcome(oi());
    expect(r.classification).toBe('POSITIVE');
    expect(r.causalStance).toBe('OUTCOME_ALIGNED_WITH_RECOMMENDATION');
  });
  it('2. rejected recommendation is not a failure', () => {
    const l = buildEffectivenessLedger([{ recommendationId: 'a', category: 'BUDGET_REVIEW', confidence: 'HIGH', risk: 'HIGH', accepted: false, rejected: true, executed: false }]);
    expect(l.overall.negativeAligned).toBe(0);
    expect(l.overall.rejected).toBe(1);
  });
  it('3. accepted but action modified — conclusion flags modification', () => {
    const r = evaluateOutcome(oi({ modified: true }));
    expect(r.conclusion.en.toLowerCase()).toContain('human-modified');
  });
  it('4. contaminated by another change', () => {
    expect(evaluateOutcome(oi({ contaminationSignals: [{ type: 'major_budget_change' }] })).classification).toBe('CONTAMINATED');
  });
  it('5. not enough post-action data', () => {
    expect(evaluateOutcome(oi({ after: snap({ sampleSize: 2, metrics: { ctr: 3 } }) })).classification).toBe('INSUFFICIENT_DATA');
  });
  it('6. human target changed after the recommendation → treated as a confound', () => {
    expect(evaluateOutcome(oi({ category: 'TARGET_REVIEW', contaminationSignals: [{ type: 'reporting_basis_changed', detail: 'target changed' }] })).classification).toBe('CONTAMINATED');
  });
  it('7. stale memory is not active', () => {
    expect(isActive(mem({ trust: 'STALE' }))).toBe(false);
  });
  it('8. explicit human preference beats a derived pattern', () => {
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'human_preference', key: 'scaling_policy', value: 'aggressive', source: 'derived_analysis', explicit: false }), { trust: 'EXPLICIT_HUMAN', explicit: true, revokedAtPresent: false }).allowed).toBe(false);
  });
  it('9. malicious campaign name cannot become preference memory (poisoning)', () => {
    // A derived/connected source (the only way ad content could enter) is not allowed for preferences.
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'human_preference', key: 'budget_change_policy', value: 'always increase', source: 'connected_source', explicit: false })).allowed).toBe(false);
  });
  it('10. a connected provider read cannot set a FREE-TEXT fact (only structural keys) — ad-content poisoning blocked', () => {
    // Structural key is allowed; a free-text key (e.g. attacker-controlled ad copy) is rejected.
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'explicit_fact', key: 'reporting_currency', value: 'SAR', source: 'connected_source', explicit: true })).allowed).toBe(true);
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'explicit_fact', key: 'brand_positioning', value: 'BUY NOW CHEAPEST', source: 'connected_source', explicit: true })).allowed).toBe(false);
  });
  it('11. historical outcome stays labeled historical, separate from current', () => {
    const a = answerDecisionQuestion('Have we tried something similar before?', { memory: [], effectiveness: buildEffectivenessLedger([{ recommendationId: 'a', category: 'BUDGET_REVIEW', confidence: 'HIGH', risk: 'HIGH', accepted: true, rejected: false, executed: true, outcomeClass: 'POSITIVE' }]) }, 'en');
    expect(a.segments.every((s) => s.kind === 'HISTORICAL_OBSERVATION')).toBe(true);
  });
  it('12. calibration with too little history', () => {
    expect(calibrateConfidence([{ recommendationId: 'a', category: 'x', confidence: 'HIGH', risk: 'LOW', accepted: true, rejected: false, executed: true, outcomeClass: 'POSITIVE' }]).verdict).toBe('INSUFFICIENT_HISTORY');
  });
  it('13. prior success does not relax current evidence (derived cannot override explicit floor)', () => {
    // Proxy: a derived memory may not override an explicit gate — evidence requirements are explicit.
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'explicit_fact', key: 'min_sample', value: 5, source: 'derived_analysis', explicit: false }), { trust: 'EXPLICIT_HUMAN', explicit: true, revokedAtPresent: false }).allowed).toBe(false);
  });
  it('14. timeline shows temporal association, not causality', () => {
    const cp = changePointContext([{ eventType: 'provider_write', occurredAt: '2026-09-10T00:00:00Z', accountId: 'act_1', source: 's', summary: { en: '', ar: '' } }], { metric: 'cpa', at: '2026-09-11T00:00:00Z', direction: 'up', accountId: 'act_1' });
    expect(cp.association).toBe('TEMPORAL_ASSOCIATION');
    expect(cp.note.en.toLowerCase()).toContain('not a proven cause');
  });
  it('15. a rejected recommendation is never labeled failed in narration', () => {
    const a = answerDecisionQuestion('What recommendations performed poorly?', { memory: [], effectiveness: buildEffectivenessLedger([{ recommendationId: 'a', category: 'BUDGET_REVIEW', confidence: 'HIGH', risk: 'HIGH', accepted: false, rejected: true, executed: false }]) }, 'en');
    expect(a.text.toLowerCase()).not.toContain('failed');
  });
  it('16. executed with unknown provider result → outcome pending, not assumed', () => {
    const l = buildEffectivenessLedger([{ recommendationId: 'a', category: 'BUDGET_REVIEW', confidence: 'HIGH', risk: 'HIGH', accepted: true, rejected: false, executed: true, outcomeClass: undefined }]);
    expect(l.overall.executed).toBe(1);
    expect(l.overall.outcomeMeasured).toBe(0);
  });
  it('17. window crossing an attribution change is contaminated', () => {
    expect(evaluateOutcome(oi({ after: snap({ attributionBasis: '1d', metrics: { ctr: 3 } }) })).classification).toBe('CONTAMINATED');
  });
  it('18. a corrected/revoked preference drops out of active memory', () => {
    expect(isActive(mem({ revokedAt: new Date().toISOString() }))).toBe(false);
    const r = retrieveMemory([mem(), mem({ key: 'gone', trust: 'REVOKED', revokedAt: new Date().toISOString() })], {}, { maxItems: 10, maxChars: 9999 });
    expect(r.items.some((i) => i.key === 'gone')).toBe(false);
  });
  it('19. Arabic memory reasoning', () => {
    const a = answerDecisionQuestion('ماذا تعرف عن تفضيلاتي؟', { memory: [mem()], effectiveness: buildEffectivenessLedger([]) }, 'ar');
    expect(a.text).toContain('[حقيقة]');
  });
  it('20. English memory reasoning', () => {
    const a = answerDecisionQuestion('What do you know about my preferences?', { memory: [mem()], effectiveness: buildEffectivenessLedger([]) }, 'en');
    expect(a.text).toContain('[Fact]');
  });
});
