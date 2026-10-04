import { describe, expect, it } from 'vitest';
import { classifyActionReadiness, currentModeBReadiness, type ReadinessSignals } from '@/lib/markting/ops/mode-b-readiness';

/**
 * PHASE C (C21) — Mode B readiness REVIEW. Classification only; never enables a write. In this
 * environment live write verification is BLOCKED_EXTERNAL, so nothing reaches
 * READY_FOR_PRODUCTION_APPROVAL honestly.
 */
const allMet: ReadinessSignals = {
  governedPathImplemented: 'MET', applyTimeRevalidation: 'MET', idempotencyAndReconcile: 'MET',
  rollbackStrategy: 'MET', killSwitch: 'MET', observabilityDelivered: 'MET',
  liveWriteVerified: 'MET', controlledPilotDesign: 'MET',
};

describe('C21 — Mode B readiness classification', () => {
  it('all gates met → READY_FOR_PRODUCTION_APPROVAL (for a rollback-capable action)', () => {
    expect(classifyActionReadiness('SET_DAILY_BUDGET', allMet).verdict).toBe('READY_FOR_PRODUCTION_APPROVAL');
  });

  it('core safety met but production gates outstanding → READY_FOR_CONTROLLED_PILOT', () => {
    const r = classifyActionReadiness('PAUSE_ENTITY', { ...allMet, liveWriteVerified: 'BLOCKED_EXTERNAL', observabilityDelivered: 'NOT_MET' });
    expect(r.verdict).toBe('READY_FOR_CONTROLLED_PILOT');
    expect(r.blockedGates).toContain('liveWriteVerified');
  });

  it('a missing core safety gate → NOT_READY', () => {
    expect(classifyActionReadiness('SET_DAILY_BUDGET', { ...allMet, killSwitch: 'NOT_MET' }).verdict).toBe('NOT_READY');
  });

  it('RESUME_ENTITY never promoted past controlled pilot even with all gates (no rollback)', () => {
    expect(classifyActionReadiness('RESUME_ENTITY', allMet).verdict).toBe('READY_FOR_CONTROLLED_PILOT');
  });

  it('current environment review: nothing is production-approved; live write is BLOCKED_EXTERNAL', () => {
    const review = currentModeBReadiness();
    expect(review).toHaveLength(3);
    for (const r of review) {
      expect(r.verdict).not.toBe('READY_FOR_PRODUCTION_APPROVAL');
      expect(r.blockedGates).toContain('liveWriteVerified');
    }
  });
});
