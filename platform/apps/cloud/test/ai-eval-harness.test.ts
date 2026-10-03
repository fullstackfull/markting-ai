import { describe, expect, it } from 'vitest';
import { runEvalSuite, runEvalScenario, liveModelAvailable } from '@/lib/markting/orchestrator/eval/harness';
import { EVAL_SCENARIOS } from '@/lib/markting/orchestrator/eval/scenarios';

/**
 * Coherence-2 Program 28 — AI evaluation HARNESS (the model-eval framework), distinct from the Phase-1
 * ai-eval.test.ts deterministic analysis suite. Grades the whole composed orchestrator answer across
 * cross-domain scenarios; live-model grading is BLOCKED_EXTERNAL but the harness runs on the
 * deterministic layer so it never silently passes.
 */
describe('Program 28 — AI evaluation harness (deterministic layer; live model BLOCKED_EXTERNAL)', () => {
  it('runs the cross-domain scenario suite and every scenario passes its rubric', () => {
    const report = runEvalSuite(EVAL_SCENARIOS, 'MODEL_DISABLED');
    // eslint-disable-next-line no-console
    console.log(`AI-EVAL ${report.passed}/${report.total} passed (mode=${report.mode})`);
    expect(report.failures, JSON.stringify(report.failures)).toEqual([]);
    expect(report.passed).toBe(report.total);
    expect(report.total).toBeGreaterThanOrEqual(50); // Program 24 expanded the dataset to ≥50
  });

  it('is honest about the live model: unavailable here, and a LIVE_MODEL run does not fake it', () => {
    expect(liveModelAvailable()).toBe(false);
    const s = runEvalScenario(EVAL_SCENARIOS[0]!, 'LIVE_MODEL');
    expect(s.result.answerSource).toBe('DETERMINISTIC_ONLY');
  });

  it('grades grounding + review-only safety on every scenario', () => {
    for (const sc of EVAL_SCENARIOS) {
      const s = runEvalScenario(sc);
      expect(s.result.diagnosis.factors.every((f) => !!f.dataTrust)).toBe(true);
      expect(s.result.recommendations.every((r) => r.requiresHumanApproval === true)).toBe(true);
    }
  });
});
