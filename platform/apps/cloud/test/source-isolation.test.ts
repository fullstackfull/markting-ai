import { describe, expect, it } from 'vitest';
import { assertResultPostureAllowed, assertNoMixedSources, classifySource } from '@/lib/markting/ops/source-guard';
import type { DataTier } from '@/lib/markting/orchestrator/trust';

/**
 * CODE-RC Program 20 — source isolation hardening. These assert the posture guard that the intelligence
 * loaders (lib/cloud/intelligence.ts) apply to every composed answer before it reaches a surface, so a
 * regression that wired the demo seed into a live deployment fails CLOSED instead of leaking synthetic
 * data to a customer.
 */
describe('assertResultPostureAllowed — composed-result posture by tier', () => {
  const liveModes = ['LIVE_READ_ONLY', 'LIVE_RECOMMENDATIONS', 'LIVE_WRITE_DISABLED', 'LIVE_WRITE_APPROVAL_ONLY'] as const;

  it('a live deployment REFUSES a SYNTHETIC (demo-seed) result', () => {
    for (const mode of liveModes) {
      const v = assertResultPostureAllowed(mode, 'SYNTHETIC');
      expect(v.ok, mode).toBe(false);
    }
  });

  it('a live deployment ALLOWS a NOT_CONNECTED/empty (UNVERIFIED) result and live tiers', () => {
    for (const tier of ['UNVERIFIED', 'PLATFORM_REPORTED', 'VALIDATED', 'RECONCILED'] as DataTier[]) {
      expect(assertResultPostureAllowed('LIVE_WRITE_DISABLED', tier).ok, tier).toBe(true);
    }
  });

  it('a DEMO deployment REFUSES a live-tier result (would be a real-data leak into demo)', () => {
    for (const tier of ['PLATFORM_REPORTED', 'VALIDATED', 'RECONCILED'] as DataTier[]) {
      expect(assertResultPostureAllowed('DEMO', tier).ok, tier).toBe(false);
    }
  });

  it('a DEMO deployment ALLOWS SYNTHETIC and the neutral UNVERIFIED tier', () => {
    expect(assertResultPostureAllowed('DEMO', 'SYNTHETIC').ok).toBe(true);
    expect(assertResultPostureAllowed('DEMO', 'UNVERIFIED').ok).toBe(true);
  });
});

describe('record-level source guard still fails closed on ambiguity/mix', () => {
  it('classifies synthetic/sandbox/live and refuses ambiguous', () => {
    expect(classifySource({ tier: 'SYNTHETIC', source: 'demo-seed' })).toBe('FIXTURE');
    expect(classifySource({ tier: 'SYNTHETIC', source: 'sandbox' })).toBe('SANDBOX');
    expect(classifySource({ tier: 'PLATFORM_REPORTED', source: 'meta:live' })).toBe('LIVE');
    // a "live" tier whose source still looks synthetic is ambiguous → UNKNOWN (fail closed)
    expect(classifySource({ tier: 'PLATFORM_REPORTED', source: 'fixture' })).toBe('UNKNOWN');
  });

  it('refuses a result set that mixes live with fixture/sandbox', () => {
    const v = assertNoMixedSources('LIVE_WRITE_DISABLED', [
      { tier: 'PLATFORM_REPORTED', source: 'meta:live' },
      { tier: 'SYNTHETIC', source: 'demo-seed' },
    ]);
    expect(v.ok).toBe(false);
  });
});
