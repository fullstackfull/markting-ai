import { describe, expect, it } from 'vitest';
import { allocateExtra, reduceBudget, type CandidateSignals } from '@/lib/markting/optimize/allocation';
import type { Candidate, HardConstraints } from '@/lib/markting/optimize/constraints';
import { fitResponseCurve, detectSaturation, marginalMetrics, withinValidity } from '@/lib/markting/optimize/response-curve';
import { simulateScenarios } from '@/lib/markting/optimize/simulate';
import { buildWorkbench, buildScenarioComparison, buildExperimentCalendar } from '@/lib/markting/optimize/workbench';
import { traceAllocation } from '@/lib/markting/optimize/trace';
import { feasibleExperimentTypes, studyTypeFor } from '@/lib/markting/optimize/experiment-model';

const sig = (over: Partial<CandidateSignals> = {}): CandidateSignals => ({ targetKnown: true, beatingTarget: true, dataTrustOk: true, scaleReady: true, ...over });

describe('allocation engine: deterministic, bounded, conserves budget', () => {
  const hard: HardConstraints = { currency: 'SAR', orgMaxBudgetMinor: 1_000_000_000 };
  it('never allocates more than the extra amount and is conservative on headroom', () => {
    const cands = Array.from({ length: 50 }, (_, i) => ({ candidate: { id: `c${i}`, currentBudgetMinor: 100000, currency: 'SAR' } as Candidate, signals: sig() }));
    const r = allocateExtra({ extraMinor: 300000, currency: 'SAR', candidates: cands, hard });
    const moved = r.moves.reduce((a, m) => a + m.deltaMinor, 0);
    expect(moved).toBe(300000 - r.unallocatedMinor);
    expect(moved).toBeLessThanOrEqual(300000);
  });
  it('is deterministic (same inputs → same moves)', () => {
    const cands = [{ candidate: { id: 'a', currentBudgetMinor: 100000, currency: 'SAR' } as Candidate, signals: sig() }, { candidate: { id: 'b', currentBudgetMinor: 100000, currency: 'SAR' } as Candidate, signals: sig({ contributionMarginPct: 40 }) }];
    const r1 = allocateExtra({ extraMinor: 100000, currency: 'SAR', candidates: cands, hard });
    const r2 = allocateExtra({ extraMinor: 100000, currency: 'SAR', candidates: cands, hard });
    expect(JSON.stringify(r1.moves)).toBe(JSON.stringify(r2.moves));
  });
  it('performance: 1,000 candidates allocate without combinatorial explosion (< 300ms)', () => {
    const cands = Array.from({ length: 1000 }, (_, i) => ({ candidate: { id: `c${i}`, currentBudgetMinor: 100000, currency: 'SAR' } as Candidate, signals: sig({ contributionMarginPct: i % 50 }) }));
    const t0 = Date.now();
    const r = allocateExtra({ extraMinor: 1_000_000, currency: 'SAR', candidates: cands, hard });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(300);
    expect(r.totalMovedMinor).toBeGreaterThan(0);
  });
  it('performance: 10,000 candidate reduction stays bounded (< 600ms)', () => {
    const cands = Array.from({ length: 10000 }, (_, i) => ({ candidate: { id: `c${i}`, currentBudgetMinor: 100000, currency: 'SAR' } as Candidate, signals: sig({ beatingTarget: i % 2 === 0 }) }));
    const t0 = Date.now();
    const r = reduceBudget({ reduceMinor: 500000, currency: 'SAR', candidates: cands, hard: { ...hard, minSpendFloorMinor: 1000 } });
    expect(Date.now() - t0).toBeLessThan(600);
    expect(r.totalMovedMinor).toBeGreaterThan(0);
  });
});

describe('response curves + saturation + marginal', () => {
  it('detects diminishing returns', () => {
    const c = fitResponseCurve([
      { spendMinor: 10000, conversions: 20 }, { spendMinor: 20000, conversions: 38 },
      { spendMinor: 30000, conversions: 50 }, { spendMinor: 40000, conversions: 55 },
      { spendMinor: 50000, conversions: 57 }, { spendMinor: 60000, conversions: 58 },
    ]);
    expect(c.form).toBe('DIMINISHING_RETURNS');
    expect(c.validityRange).toBeTruthy();
    expect(withinValidity(c, 35000)).toBe(true);
  });
  it('insufficient evidence → no curve, no extrapolation', () => {
    const c = fitResponseCurve([{ spendMinor: 10000, conversions: 5 }]);
    expect(c.form).toBe('INSUFFICIENT_EVIDENCE');
    expect(withinValidity(c, 10000)).toBe(false);
  });
  it('saturation STRONG needs core pair + a corroborator', () => {
    expect(detectSaturation({ marginalConversionsWeakening: true, cpaWorsening: true, frequencyRising: true }).state).toBe('STRONG_SATURATION_SIGNAL');
    expect(detectSaturation({ cpaWorsening: true }).state).toBe('SATURATION_SIGNAL');
    expect(detectSaturation({ spendRising: true }).state).toBe('NO_SIGNAL');
  });
  it('marginal metrics require material spend change + conversions', () => {
    const m = marginalMetrics({ spendMinor: 100000, conversions: 50 }, { spendMinor: 150000, conversions: 90, revenueMinor: 450000 });
    expect(m.marginalCpa).toBeGreaterThan(0);
  });
});

describe('simulation provenance + workbench', () => {
  it('projects within validity and tags provenance; UNKNOWN outside range', () => {
    const curve = fitResponseCurve([{ spendMinor: 10000, conversions: 20 }, { spendMinor: 20000, conversions: 40 }, { spendMinor: 30000, conversions: 60 }, { spendMinor: 40000, conversions: 80 }]);
    const sims = simulateScenarios({ spendMinor: 20000, conversions: 40, revenueMinor: 400000, currency: 'SAR', responseCurve: curve }, [
      { label: 'SCENARIO_A', spendMinor: 30000, currency: 'SAR' },
      { label: 'SCENARIO_B', spendMinor: 500000, currency: 'SAR' },
    ]);
    expect(sims[0]!.conversions.provenance).toBe('OBSERVED');
    expect(sims[1]!.conversions.provenance).toBe('PROJECTED');
    expect(sims[2]!.conversions.provenance).toBe('UNKNOWN'); // outside validity
  });
  it('workbench has no execution affordance + scenario comparison caveat', () => {
    const wb = buildWorkbench({});
    expect(wb.executionPath).toBe('phase0_preview_approval_only');
    const cmp = buildScenarioComparison(simulateScenarios({ spendMinor: 10000, conversions: 10, currency: 'SAR' }, []));
    expect(cmp.caveat.en.toLowerCase()).toContain('not guarantees');
    const cal = buildExperimentCalendar([]);
    expect(cal.note.en.toLowerCase()).toContain('never');
  });
  it('allocation trace is auditable (inputs/constraints/calcs/assumptions/outputs)', () => {
    const r = allocateExtra({ extraMinor: 100000, currency: 'SAR', candidates: [{ candidate: { id: 'c1', currentBudgetMinor: 100000, currency: 'SAR' } as Candidate, signals: sig() }], hard: { currency: 'SAR' } });
    const trace = traceAllocation({ request: { mode: r.mode, amountMinor: 100000, currency: 'SAR', candidateCount: 1 }, hard: { currency: 'SAR' }, soft: {}, result: r });
    expect(trace.engine).toBe('deterministic_greedy');
    expect(trace.calculations.length).toBeGreaterThan(0);
    expect(trace.assumptions.length).toBeGreaterThan(0);
  });
  it('feasible experiment types gate on available data', () => {
    const types = feasibleExperimentTypes({ hasCreativeData: true });
    expect(types).toContain('CREATIVE_TEST');
    expect(types).not.toContain('BUDGET_INCREASE');
    expect(studyTypeFor('none_observational')).toBe('OBSERVATIONAL');
  });
});
