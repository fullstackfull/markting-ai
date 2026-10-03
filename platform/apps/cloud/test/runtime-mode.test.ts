import { describe, expect, it } from 'vitest';
import { resolveRuntimeMode, canApply, canPreview, assertApplyAllowed } from '@/lib/markting/runtime-mode';

describe('runtime safety states (R0-12)', () => {
  it('has no autonomous-write state in the type', () => {
    // A compile-time guarantee is enforced by the RuntimeMode union; at runtime, resolving a
    // forged value falls back to a safe state rather than enabling writes.
    expect(() => resolveRuntimeMode({ MARKTING_RUNTIME_MODE: 'FULL_AUTONOMOUS_WRITE' })).toThrow();
  });

  it('fails closed: a non-demo deployment defaults to LIVE_WRITE_DISABLED', () => {
    expect(resolveRuntimeMode({})).toBe('LIVE_WRITE_DISABLED');
    expect(resolveRuntimeMode({ MARKTING_DEMO_MODE: 'false' })).toBe('LIVE_WRITE_DISABLED');
  });

  it('demo deployment resolves to DEMO', () => {
    expect(resolveRuntimeMode({ MARKTING_DEMO_MODE: 'true' })).toBe('DEMO');
  });

  it('an explicit mode wins', () => {
    expect(resolveRuntimeMode({ MARKTING_RUNTIME_MODE: 'LIVE_READ_ONLY' })).toBe('LIVE_READ_ONLY');
  });

  it('apply is allowed only in DEMO and LIVE_WRITE_APPROVAL_ONLY', () => {
    expect(canApply('DEMO')).toBe(true);
    expect(canApply('LIVE_WRITE_APPROVAL_ONLY')).toBe(true);
    expect(canApply('LIVE_WRITE_DISABLED')).toBe(false);
    expect(canApply('LIVE_READ_ONLY')).toBe(false);
    expect(canApply('LIVE_RECOMMENDATIONS')).toBe(false);
  });

  it('preview is allowed in write-capable live modes but not read-only/recommendation modes', () => {
    expect(canPreview('LIVE_WRITE_DISABLED')).toBe(true);
    expect(canPreview('LIVE_READ_ONLY')).toBe(false);
  });

  it('assertApplyAllowed throws (409) in a write-disabled mode', () => {
    expect(() => assertApplyAllowed('LIVE_WRITE_DISABLED')).toThrow();
    expect(() => assertApplyAllowed('DEMO')).not.toThrow();
  });
});
