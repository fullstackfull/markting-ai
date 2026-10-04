import { describe, expect, it } from 'vitest';
import { supportsBreakdown, BREAKDOWN_DIMENSIONS } from '@/lib/markting/intelligence/audience';
import { reportingDimensionSupport, type BreakdownDimension } from '@/lib/connections/registry';

/**
 * PHASE C0.2 — the provider capability registry is the ONE source of truth. The analysis engine's
 * breakdown-support predicate (`supportsBreakdown`) must be a pure projection of the registry's
 * `reportingDimensionSupport`, never a second hand-maintained map. This test pins that invariant so a
 * future edit that reintroduces a divergent map fails CI.
 */
const ENGINE_TO_REGISTRY: Record<string, BreakdownDimension> = {
  placement: 'placement', device: 'device', geography: 'geography',
  audience_segment: 'audience', age: 'age', gender: 'gender',
};

describe('C0.2 — breakdown support is a projection of the canonical registry', () => {
  const providers = ['meta', 'google', 'tiktok', 'snapchat', 'reddit', 'linkedin', 'x', 'apple', 'microsoft', 'unknown-provider'];

  it('supportsBreakdown agrees with reportingDimensionSupport for every provider/dimension', () => {
    for (const provider of providers) {
      for (const dim of BREAKDOWN_DIMENSIONS) {
        const support = reportingDimensionSupport(provider, ENGINE_TO_REGISTRY[dim]!);
        const expected = support === 'READY' || support === 'RAW_ONLY';
        expect(supportsBreakdown(provider, dim), `${provider}/${dim} (registry=${support})`).toBe(expected);
      }
    }
  });

  it('reflects the audited registry truth, not the old optimistic map (meta audience_segment is NOT reachable; google has no normalized breakdown)', () => {
    // Old divergent map claimed meta.audience_segment=true and google.placement/device/geo/age/gender=true.
    expect(supportsBreakdown('meta', 'audience_segment')).toBe(false);
    expect(supportsBreakdown('meta', 'placement')).toBe(true); // RAW_ONLY in the registry
    for (const dim of BREAKDOWN_DIMENSIONS) expect(supportsBreakdown('google', dim)).toBe(false);
  });

  it('an unknown provider supports no breakdown (no fabricated capability)', () => {
    for (const dim of BREAKDOWN_DIMENSIONS) expect(supportsBreakdown('unknown-provider', dim)).toBe(false);
  });
});
