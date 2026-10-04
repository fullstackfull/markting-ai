import { describe, expect, it } from 'vitest';
import {
  SAFE_DEFAULTS, assertSafeDefaults, assertSafeDefaultsOrThrow, safeDefaultsSelfCheck,
  isCompleteOptIn, VERBOSE_LOG_LEVELS, LIVE_RUNTIME_MODES, DANGEROUS_TOGGLES,
  type AuditedOptIn, type EffectiveRuntimeConfig,
} from '@/lib/markting/ops/safe-defaults';

const optIn = (o: Partial<AuditedOptIn> = {}): AuditedOptIn => ({
  approvedBy: 'ops@markting', ticket: 'OPS-123', reason: 'audited launch', at: '2026-10-04T00:00:00Z', ...o,
});

describe('C.6-38 — canonical safe defaults', () => {
  it('the default set is the dangerous-OFF posture', () => {
    expect(SAFE_DEFAULTS.runtimeMode).toBe('DEMO');
    expect(SAFE_DEFAULTS.modeB).toBe('HELD');
    expect(SAFE_DEFAULTS.autonomousOptimization).toBe('DISABLED');
    expect(SAFE_DEFAULTS.providerWrites).toBe('OFF');
    expect(SAFE_DEFAULTS.liveModel).toBe('OFF');
    expect(SAFE_DEFAULTS.globalWriteHalted).toBe(true);
    expect(VERBOSE_LOG_LEVELS.has(SAFE_DEFAULTS.logLevel)).toBe(false);
  });

  it('the default set is frozen (cannot be mutated unsafe at runtime)', () => {
    expect(Object.isFrozen(SAFE_DEFAULTS)).toBe(true);
    expect(() => {
      (SAFE_DEFAULTS as { modeB: string }).modeB = 'ENABLED';
    }).toThrow();
  });

  it('the canonical defaults self-check as safe', () => {
    expect(safeDefaultsSelfCheck().safe).toBe(true);
  });

  it('an empty config is fully safe (absent = safe default)', () => {
    expect(assertSafeDefaults({}).safe).toBe(true);
    expect(assertSafeDefaults().safe).toBe(true);
  });

  it('LIVE_RUNTIME_MODES excludes DEMO', () => {
    expect(LIVE_RUNTIME_MODES).not.toContain('DEMO');
    expect(LIVE_RUNTIME_MODES.length).toBeGreaterThan(0);
  });
});

describe('C.6-38 — autonomous optimization can never be ON', () => {
  it('ENABLED is always a CRITICAL violation', () => {
    const r = assertSafeDefaults({ autonomousOptimization: 'ENABLED' });
    expect(r.safe).toBe(false);
    const v = r.violations.find((x) => x.toggle === 'autonomousOptimization');
    expect(v?.severity).toBe('CRITICAL');
  });

  it('cannot be cleared by any opt-in (no governed autonomous-write path)', () => {
    // even a complete opt-in on every toggle does not legitimize autonomous ENABLED
    const optIns = Object.fromEntries(DANGEROUS_TOGGLES.map((t) => [t, optIn()]));
    const r = assertSafeDefaults({ autonomousOptimization: 'ENABLED', optIns });
    expect(r.safe).toBe(false);
    expect(r.violations.some((v) => v.toggle === 'autonomousOptimization')).toBe(true);
  });
});

describe('C.6-38 — dangerous flips require a complete audited opt-in', () => {
  const dangerous: EffectiveRuntimeConfig = {
    runtimeMode: 'LIVE_WRITE_APPROVAL_ONLY',
    modeB: 'ENABLED',
    providerWrites: 'ON',
    liveModel: 'ON',
    globalWriteHalted: false,
    logLevel: 'debug',
  };

  it('every flip without opt-in is a violation', () => {
    const r = assertSafeDefaults(dangerous);
    expect(r.safe).toBe(false);
    const toggles = r.violations.map((v) => v.toggle).sort();
    expect(toggles).toEqual(['clearGlobalWriteHalt', 'liveModel', 'liveRuntimeMode', 'modeB', 'providerWrites', 'verboseLogging'].sort());
  });

  it('complete opt-ins on every toggle clear the violations', () => {
    const r = assertSafeDefaults({
      ...dangerous,
      optIns: {
        liveRuntimeMode: optIn(), modeB: optIn(), providerWrites: optIn(),
        liveModel: optIn(), clearGlobalWriteHalt: optIn(), verboseLogging: optIn(),
      },
    });
    expect(r.safe).toBe(true);
  });

  it('an incomplete opt-in (blank field) does NOT clear a violation', () => {
    const r = assertSafeDefaults({ modeB: 'ENABLED', optIns: { modeB: optIn({ ticket: '' }) } });
    expect(r.safe).toBe(false);
    expect(r.violations[0]?.toggle).toBe('modeB');
  });

  it('isCompleteOptIn rejects blanks and whitespace', () => {
    expect(isCompleteOptIn(optIn())).toBe(true);
    expect(isCompleteOptIn(optIn({ reason: '   ' }))).toBe(false);
    expect(isCompleteOptIn(undefined)).toBe(false);
  });
});

describe('C.6-38 — Mode B HELD + global-halt are enforced defaults', () => {
  it('Mode B ENABLED without opt-in is CRITICAL', () => {
    const v = assertSafeDefaults({ modeB: 'ENABLED' }).violations;
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe('CRITICAL');
  });

  it('clearing the global write halt without opt-in is CRITICAL', () => {
    const v = assertSafeDefaults({ globalWriteHalted: false }).violations;
    expect(v[0]?.toggle).toBe('clearGlobalWriteHalt');
    expect(v[0]?.severity).toBe('CRITICAL');
  });
});

describe('C.6-38 — throwing variant', () => {
  it('throws on a violation with an operator-safe message', () => {
    expect(() => assertSafeDefaultsOrThrow({ modeB: 'ENABLED' })).toThrow(/Mode B must stay HELD/);
  });
  it('does not throw on a safe config', () => {
    expect(() => assertSafeDefaultsOrThrow({})).not.toThrow();
  });
});
