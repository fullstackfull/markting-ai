import { describe, expect, it } from 'vitest';
import { applyConfigured, emptyBusinessContext, withDerived } from '@/lib/markting/business-context';

describe('business context provenance (1G)', () => {
  it('absent values stay UNKNOWN and are never invented', () => {
    const ctx = emptyBusinessContext('org-1');
    expect(ctx.targetCpa).toEqual({ value: null, provenance: 'UNKNOWN' });
    expect(ctx.grossMargin.provenance).toBe('UNKNOWN');
    expect(ctx.breakEvenRoas.provenance).toBe('UNKNOWN');
  });
  it('user-set values are tagged CONFIGURED', () => {
    const ctx = applyConfigured(emptyBusinessContext('org-1'), { targetRoas: 3, reportingCurrency: 'SAR', targetCountries: ['SA', 'AE'] });
    expect(ctx.targetRoas).toEqual({ value: 3, provenance: 'CONFIGURED' });
    expect(ctx.reportingCurrency).toEqual({ value: 'SAR', provenance: 'CONFIGURED' });
    expect(ctx.targetCountries).toEqual({ value: ['SA', 'AE'], provenance: 'CONFIGURED' });
    expect(ctx.targetCpa.provenance).toBe('UNKNOWN'); // not set → still unknown
  });
  it('break-even ROAS is DERIVED from a configured gross margin, not invented', () => {
    const ctx = applyConfigured(emptyBusinessContext('org-1'), { grossMargin: 0.5 });
    expect(ctx.breakEvenRoas).toEqual({ value: 2, provenance: 'DERIVED' });
    // With no margin, break-even stays UNKNOWN.
    expect(withDerived(emptyBusinessContext('org-1')).breakEvenRoas.provenance).toBe('UNKNOWN');
  });
  it('rejects unknown configured fields (strict)', () => {
    expect(() => applyConfigured(emptyBusinessContext('org-1'), { nonsense: true })).toThrow();
  });
});
