import { describe, expect, it } from 'vitest';
import { evaluateEvidence, SYNTHETIC_TRUST, MIN_SAMPLE_FOR_CONFIDENCE, type DataTrust } from '@/lib/markting/data-trust';

describe('data-trust floor (R0-11)', () => {
  it('synthetic/demo data is never actionable as live evidence', () => {
    const v = evaluateEvidence(SYNTHETIC_TRUST);
    expect(v.actionable).toBe(false);
    expect(v.code).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('UNVERIFIED data is not actionable', () => {
    expect(evaluateEvidence({ tier: 'UNVERIFIED', source: 'x' }).actionable).toBe(false);
  });

  it('a partial (open) window is not actionable', () => {
    const trust: DataTrust = { tier: 'PLATFORM_REPORTED', source: 'adport-report', complete: false };
    const v = evaluateEvidence(trust);
    expect(v.actionable).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/partial|open/);
  });

  it('a ratio-based recommendation below the sample floor returns INSUFFICIENT_EVIDENCE', () => {
    const trust: DataTrust = { tier: 'VALIDATED', source: 'adport-report', complete: true, sampleSize: MIN_SAMPLE_FOR_CONFIDENCE - 1 };
    expect(evaluateEvidence(trust, { ratioBased: true }).actionable).toBe(false);
    expect(evaluateEvidence(trust, { ratioBased: true }).code).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('closed, sufficiently-sampled platform-reported data is actionable', () => {
    const trust: DataTrust = { tier: 'PLATFORM_REPORTED', source: 'adport-report', complete: true, sampleSize: MIN_SAMPLE_FOR_CONFIDENCE };
    expect(evaluateEvidence(trust, { ratioBased: true }).actionable).toBe(true);
  });

  it('does not claim statistical significance — only enforces existence of evidence', () => {
    // A non-ratio change on complete platform-reported data needs no sample floor.
    expect(evaluateEvidence({ tier: 'PLATFORM_REPORTED', source: 'x', complete: true }).actionable).toBe(true);
  });
});
