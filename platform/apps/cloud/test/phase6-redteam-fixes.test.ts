import { describe, expect, it } from 'vitest';
import { allocateExtra, reduceBudget, scalePriority, type CandidateSignals } from '@/lib/markting/optimize/allocation';
import type { Candidate, HardConstraints } from '@/lib/markting/optimize/constraints';
import { fitResponseCurve } from '@/lib/markting/optimize/response-curve';
import { evaluateExperimentOutcome } from '@/lib/markting/optimize/outcome';

const sig = (over: Partial<CandidateSignals> = {}): CandidateSignals => ({ targetKnown: true, beatingTarget: true, dataTrustOk: true, scaleReady: true, ...over });
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({ id, currentBudgetMinor: 100000, currency: 'SAR', ...over });

describe('Phase-6 red-team fixes', () => {
  // #10 reduceBudget must not cut a campaign in an active experiment.
  it('reduceBudget excludes experiment-excluded candidates (no mid-experiment contamination)', () => {
    const r = reduceBudget({ reduceMinor: 50000, currency: 'SAR', candidates: [{ candidate: cand('c1'), signals: sig({ beatingTarget: false }) }], hard: { currency: 'SAR', experimentExcludedIds: ['c1'], minSpendFloorMinor: 0 } });
    expect(r.moves).toHaveLength(0);
    expect(r.unallocatedMinor).toBe(50000);
  });

  // #9 aggregate org cap must not be breached across candidates.
  it('allocateExtra respects the AGGREGATE org budget cap, not just per-candidate', () => {
    const r = allocateExtra({
      extraMinor: 300000, currency: 'SAR',
      candidates: [{ candidate: cand('a', { currentBudgetMinor: 450000 }), signals: sig() }, { candidate: cand('b', { currentBudgetMinor: 450000 }), signals: sig() }],
      hard: { currency: 'SAR', orgMaxBudgetMinor: 1_000_000 },
    });
    // org currently 900,000; cap 1,000,000 → at most 100,000 may be added in aggregate.
    expect(r.totalMovedMinor).toBe(100000);
    expect(r.unallocatedMinor).toBe(200000);
    const newOrgTotal = 900000 + r.totalMovedMinor;
    expect(newOrgTotal).toBeLessThanOrEqual(1_000_000);
  });

  // #11 brand/strategic are structurally protected from reduction by default (not soft-only).
  it('reduceBudget does not raid brand/strategic campaigns by default', () => {
    const r = reduceBudget({ reduceMinor: 50000, currency: 'SAR', candidates: [{ candidate: cand('brand', { role: 'brand' }), signals: sig({ beatingTarget: false }) }], hard: { currency: 'SAR', minSpendFloorMinor: 0 } });
    expect(r.moves).toHaveLength(0); // brand protected without needing a soft flag or protected list
    // explicit opt-out allows reducing them
    const r2 = reduceBudget({ reduceMinor: 50000, currency: 'SAR', candidates: [{ candidate: cand('brand', { role: 'brand' }), signals: sig({ beatingTarget: false }) }], hard: { currency: 'SAR', minSpendFloorMinor: 0 }, soft: { preserveBrandCampaigns: false } });
    expect(r2.moves.length).toBe(1);
  });

  // #12 experiment outcome stance is clamped to the study's causal ceiling.
  it('observational before/after outcome stance never exceeds temporal association', () => {
    const snap = (roas: number) => ({ entityId: 'c1', entityLevel: 'campaign', accountId: 'act_1', window: { start: '2026-09-01', end: '2026-09-15' }, currency: 'SAR', trust: 'PLATFORM_REPORTED' as const, complete: true, metrics: { roas }, sampleSize: 60 });
    const out = evaluateExperimentOutcome({ studyType: 'OBSERVATIONAL', outcome: { recommendationId: 'r', category: 'BUDGET_REVIEW', windowLabel: '14d', before: snap(2), after: snap(3) }, windowComplete: true, sampleSufficient: true });
    // observational ceiling → at most OUTCOME_ALIGNED_WITH_RECOMMENDATION; never TEMPORAL/CAUSAL.
    expect(['NOT_ESTABLISHED', 'OUTCOME_ALIGNED_WITH_RECOMMENDATION']).toContain(out.outcome.causalStance);
  });

  // #13 STRONG saturation holds a candidate out of scaling (symmetric with creative fatigue).
  it('strong saturation flags a scale HOLD and is not allocated budget', () => {
    const p = scalePriority(cand('c1'), sig({ saturation: 'STRONG_SATURATION_SIGNAL' }), {});
    expect(p.flags).toContain('SCALE_HOLD_PENDING_SATURATION_REVIEW');
    const r = allocateExtra({ extraMinor: 100000, currency: 'SAR', candidates: [{ candidate: cand('c1'), signals: sig({ saturation: 'STRONG_SATURATION_SIGNAL' }) }], hard: { currency: 'SAR' } });
    expect(r.moves).toHaveLength(0);
  });

  // #14 diminishing-returns marginal uses the conservative local slope (≤ average).
  it('diminishing-returns curve reports a conservative (local) marginal, not the optimistic average', () => {
    const c = fitResponseCurve([
      { spendMinor: 10000, conversions: 20 }, { spendMinor: 20000, conversions: 38 },
      { spendMinor: 30000, conversions: 50 }, { spendMinor: 40000, conversions: 55 },
      { spendMinor: 50000, conversions: 57 }, { spendMinor: 60000, conversions: 58 },
    ]);
    expect(c.form).toBe('DIMINISHING_RETURNS');
    // last-segment marginal is (58-57)/10000 = 0.0001; average over the whole range is much higher.
    const avg = (58 - 20) / (60000 - 10000);
    expect(c.marginalConversionsPerMinor!).toBeLessThanOrEqual(avg);
    expect(c.limitations.join(' ')).toMatch(/conservative last-segment/);
  });
});
