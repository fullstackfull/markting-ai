import { describe, expect, it } from 'vitest';
import { evaluateOutcome, recommendedWindows, windowToMs, type OutcomeInput, type OutcomeSnapshot } from '@/lib/markting/outcomes';
import { evaluateWritePolicy, trustForSource, isActive, memoryWriteSchema, type MemoryItem } from '@/lib/markting/memory';
import { retrieveMemory } from '@/lib/markting/memory-retrieval';
import { personalizeRecommendation } from '@/lib/markting/playbook';
import { buildEffectivenessLedger, calibrateConfidence, type LedgerRow } from '@/lib/markting/learning';
import { changePointContext, type TimelineEvent } from '@/lib/markting/timeline';
import { answerDecisionQuestion, classifyDecisionQuestion } from '@/lib/markting/decision-aware-ask';
import type { Recommendation } from '@/lib/markting/intelligence/decision-model';

function snap(over: Partial<OutcomeSnapshot> = {}): OutcomeSnapshot {
  return { entityId: 'meta:act_1:c1', entityLevel: 'campaign', accountId: 'act_1', window: { start: '2026-09-01', end: '2026-09-07' }, currency: 'SAR', attributionBasis: '7d', trust: 'PLATFORM_REPORTED', complete: true, sampleSize: 60, metrics: {}, ...over };
}
function outInput(over: Partial<OutcomeInput> = {}): OutcomeInput {
  return { recommendationId: 'rec_1', category: 'CREATIVE_REVIEW', windowLabel: '7d', before: snap({ metrics: { ctr: 2 } }), after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, metrics: { ctr: 3 } }), ...over };
}

describe('outcome engine (3C): classification + causal restraint', () => {
  it('POSITIVE when the primary metric improved in the beneficial direction — but only ALIGNED, never caused', () => {
    const r = evaluateOutcome(outInput()); // CREATIVE_REVIEW → ctr up is good
    expect(r.classification).toBe('POSITIVE');
    expect(r.causalStance).toBe('OUTCOME_ALIGNED_WITH_RECOMMENDATION');
    expect(r.conclusion.en.toLowerCase()).toContain('not proven causation');
  });
  it('NEGATIVE when it worsened', () => {
    expect(evaluateOutcome(outInput({ before: snap({ metrics: { ctr: 3 } }), after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, metrics: { ctr: 2 } }) })).classification).toBe('NEGATIVE');
  });
  it('NEUTRAL within the noise band', () => {
    expect(evaluateOutcome(outInput({ before: snap({ metrics: { ctr: 2 } }), after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, metrics: { ctr: 2.05 } }) })).classification).toBe('NEUTRAL');
  });
  it('CONTAMINATED when an external change confounds the window', () => {
    expect(evaluateOutcome(outInput({ contaminationSignals: [{ type: 'promotion_started' }] })).classification).toBe('CONTAMINATED');
  });
  it('CONTAMINATED when currency or attribution changed between windows', () => {
    expect(evaluateOutcome(outInput({ after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, currency: 'USD', metrics: { ctr: 3 } }) })).classification).toBe('CONTAMINATED');
    expect(evaluateOutcome(outInput({ after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, attributionBasis: '1d', metrics: { ctr: 3 } }) })).classification).toBe('CONTAMINATED');
  });
  it('INSUFFICIENT_DATA on a partial/thin/low-trust after-window', () => {
    expect(evaluateOutcome(outInput({ after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, complete: false, metrics: { ctr: 3 } }) })).classification).toBe('INSUFFICIENT_DATA');
    expect(evaluateOutcome(outInput({ after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, sampleSize: 3, metrics: { ctr: 3 } }) })).classification).toBe('INSUFFICIENT_DATA');
    expect(evaluateOutcome(outInput({ after: snap({ window: { start: '2026-09-08', end: '2026-09-14' }, trust: 'SYNTHETIC', metrics: { ctr: 3 } }) })).classification).toBe('INSUFFICIENT_DATA');
  });
  it('windows are per-category, not universal', () => {
    expect(recommendedWindows('TRACKING_REVIEW')).toContain('24h');
    expect(recommendedWindows('BUDGET_REVIEW')).toContain('14d');
    expect(windowToMs('3d')).toBe(3 * 86_400_000);
  });
});

describe('memory write policy (3F/3T): poisoning defense + trust ordering', () => {
  it('a provider/connected source cannot create a human preference (poisoning defense)', () => {
    const r = evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'human_preference', key: 'scaling_policy', value: 'aggressive', source: 'connected_source', explicit: false }));
    expect(r.allowed).toBe(false);
  });
  it('a high-impact preference requires explicit human confirmation', () => {
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'human_preference', key: 'auto_approval_threshold', value: 1000, source: 'derived_analysis', explicit: false })).allowed).toBe(false);
    expect(evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'human_preference', key: 'auto_approval_threshold', value: 1000, source: 'human_confirmation', explicit: true })).allowed).toBe(true);
  });
  it('a derived memory may not override an explicit human-configured value', () => {
    const r = evaluateWritePolicy(memoryWriteSchema.parse({ organizationId: 'o', category: 'explicit_fact', key: 'target_roas', value: 2, source: 'derived_analysis', explicit: false }), { trust: 'EXPLICIT_HUMAN', explicit: true, revokedAtPresent: false });
    expect(r.allowed).toBe(false);
  });
  it('trust derives from source; isActive excludes revoked/stale/expired', () => {
    expect(trustForSource('human_config', true)).toBe('EXPLICIT_HUMAN');
    expect(trustForSource('derived_analysis', false)).toBe('DERIVED_LOW_CONFIDENCE');
    const base: Pick<MemoryItem, 'trust' | 'revokedAt' | 'expiresAt'> = { trust: 'EXPLICIT_HUMAN', revokedAt: undefined, expiresAt: undefined };
    expect(isActive(base)).toBe(true);
    expect(isActive({ ...base, trust: 'REVOKED' })).toBe(false);
    expect(isActive({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe(false);
  });
});

describe('memory retrieval (3G): bounded + relevant', () => {
  function item(key: string, over: Partial<MemoryItem> = {}): MemoryItem {
    return { organizationId: 'o', category: 'explicit_fact', key, value: {}, source: 'human_config', trust: 'EXPLICIT_HUMAN', explicit: true, createdAt: new Date().toISOString(), ...over };
  }
  it('caps item count and excludes revoked', () => {
    const items = Array.from({ length: 50 }, (_, i) => item(`k${i}`));
    items.push(item('revoked', { trust: 'REVOKED', revokedAt: new Date().toISOString() }));
    const r = retrieveMemory(items, {}, { maxItems: 5, maxChars: 10000 });
    expect(r.items.length).toBe(5);
    expect(r.items.some((i) => i.key === 'revoked')).toBe(false);
    expect(r.truncatedCount).toBeGreaterThan(0);
  });
});

describe('playbook personalization (3J): phrasing only, evidence unchanged', () => {
  function rec(over: Partial<Recommendation> = {}): Recommendation {
    return { recommendationId: 'r', organizationId: 'o', accountId: 'act_1', entityScope: { entityId: 'meta:act_1:c1', entityLevel: 'campaign', name: 'C1' }, category: 'BUDGET_REVIEW', actionType: 'REVIEW_BUDGET_SCALE', diagnosis: { type: 'ROAS_IMPROVEMENT' } as never, reasoning: { en: 'x', ar: 'x' }, evidence: [], confidence: 'HIGH', risk: 'HIGH', dataTrust: 'PLATFORM_REPORTED', expectedImpact: 'POSITIVE_DIRECTION_EXPECTED', alternatives: [], requiresHumanApproval: true, status: 'REVIEWABLE', expiresAt: '', createdAt: '', ...over };
  }
  it('conservative policy adds a staged-scaling note without changing confidence/risk/status', () => {
    const r = personalizeRecommendation(rec(), { budgetChangePolicy: 'conservative' });
    expect(r.notes.some((n) => n.kind === 'staged_scaling')).toBe(true);
    expect(r.recommendation.confidence).toBe('HIGH');
    expect(r.recommendation.risk).toBe('HIGH');
    expect(r.recommendation.status).toBe('REVIEWABLE');
  });
  it('a safety/data-quality review is never de-emphasized by category preferences', () => {
    const r = personalizeRecommendation(rec({ category: 'TRACKING_REVIEW', actionType: 'REVIEW_TRACKING' }), { allowedRecommendationCategories: ['BUDGET_REVIEW'] });
    expect(r.deEmphasized).toBe(false);
  });
});

describe('learning + calibration (3K/3L): sample-aware, no vanity score', () => {
  const rows: LedgerRow[] = [
    { recommendationId: 'a', category: 'BUDGET_REVIEW', provider: 'meta', confidence: 'HIGH', risk: 'HIGH', accepted: true, rejected: false, executed: true, outcomeClass: 'POSITIVE' },
    { recommendationId: 'b', category: 'BUDGET_REVIEW', provider: 'meta', confidence: 'LOW', risk: 'MODERATE', accepted: false, rejected: true, executed: false, outcomeClass: undefined, rejectionReason: 'insufficient_evidence' },
  ];
  it('ledger counts per dimension and never implies a global accuracy', () => {
    const l = buildEffectivenessLedger(rows);
    expect(l.byCategory['BUDGET_REVIEW']!.made).toBe(2);
    expect(l.byCategory['BUDGET_REVIEW']!.positiveAligned).toBe(1);
    expect(l.rejectionReasons['insufficient_evidence']).toBe(1);
    expect(l.note.toLowerCase()).toContain('no global accuracy');
  });
  it('calibration reports INSUFFICIENT_HISTORY with too little data', () => {
    expect(calibrateConfidence(rows).verdict).toBe('INSUFFICIENT_HISTORY');
  });
});

describe('timeline (3Q): temporal association, never causality', () => {
  it('surfaces a preceding change as TEMPORAL_ASSOCIATION', () => {
    const tl: TimelineEvent[] = [
      { eventType: 'provider_write', occurredAt: '2026-09-10T00:00:00Z', accountId: 'act_1', entityId: 'c1', source: 'apply', summary: { en: 'budget raised', ar: '' } },
      { eventType: 'performance_shift', occurredAt: '2026-09-12T00:00:00Z', accountId: 'act_1', entityId: 'c1', source: 'engine', summary: { en: 'CPA up', ar: '' } },
    ];
    const cp = changePointContext(tl, { metric: 'cpa', at: '2026-09-12T00:00:00Z', direction: 'up', accountId: 'act_1', entityId: 'c1' });
    expect(cp.association).toBe('TEMPORAL_ASSOCIATION');
    expect(cp.note.en.toLowerCase()).toContain('not a proven cause');
  });
});

describe('decision-aware ask (3H): labeled provenance, rejected != failed', () => {
  const ctx = { memory: [{ organizationId: 'o', category: 'human_preference' as const, key: 'risk_tolerance', value: 'low', source: 'human_config' as const, trust: 'EXPLICIT_HUMAN' as const, explicit: true, createdAt: new Date().toISOString() }], effectiveness: buildEffectivenessLedger([{ recommendationId: 'a', category: 'BUDGET_REVIEW', confidence: 'HIGH', risk: 'HIGH', accepted: false, rejected: true, executed: false }]) };
  it('classifies and labels', () => {
    expect(classifyDecisionQuestion('What do you know about my preferences?')).toBe('KNOWN_PREFERENCES');
    const a = answerDecisionQuestion('What do you know about my preferences?', ctx, 'en');
    expect(a.segments[0]!.kind).toBe('FACT');
    expect(a.text).toContain('[Fact]');
  });
  it('a rejected recommendation is reported as a pattern, not a failure', () => {
    const a = answerDecisionQuestion('Do I usually reject aggressive scaling?', ctx, 'en');
    expect(a.text.toLowerCase()).not.toContain('failed');
  });
});
