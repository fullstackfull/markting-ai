import { describe, expect, it } from 'vitest';
import {
  FLAG_REGISTRY,
  FixedClock,
  FlagSafetyError,
  InMemoryFlagStore,
  effectiveFlags,
  enableFlag,
  isHardPinnedOff,
  killFlag,
  listHardPinnedFlags,
  resolveFlag,
  setFlag,
  type FlagKey,
} from '@/lib/markting/ops/feature-flag-safety';

/**
 * Phase C.6 (28) — feature-flag production safety. Risky capabilities are hard-pinned OFF (Mode B HELD
 * + autonomous optimization DISABLED), production force-off guard, kill-flag, and an audit per change.
 */
const AT = '2026-10-04T12:00:00.000Z';
const clock = new FixedClock(AT);

describe('registry invariants', () => {
  it('every risky flag is default-OFF in production', () => {
    for (const key of Object.keys(FLAG_REGISTRY) as FlagKey[]) {
      if (FLAG_REGISTRY[key].risky) expect(FLAG_REGISTRY[key].productionDefault, key).toBe(false);
    }
  });

  it('the hard-pinned set is the live-write / autonomous-optimization / live-model flags', () => {
    expect(listHardPinnedFlags().sort()).toEqual(
      ['autonomous_bidding', 'autonomous_budget_optimization', 'live_model_calls', 'live_provider_writes'].sort(),
    );
    expect(isHardPinnedOff('live_provider_writes')).toBe(true);
    expect(isHardPinnedOff('new_commerce_ui')).toBe(false);
  });
});

describe('runtime enable guard', () => {
  it('REFUSES enabling a hard-pinned flag via setFlag', async () => {
    const store = new InMemoryFlagStore();
    await expect(setFlag(store, clock, 'live_provider_writes', true, 'op', 'try')).rejects.toBeInstanceOf(FlagSafetyError);
    await expect(setFlag(store, clock, 'autonomous_budget_optimization', true, 'op', 'try')).rejects.toThrow(/hard-pinned OFF/);
    // Nothing was written.
    expect(await store.getState('live_provider_writes')).toBeUndefined();
    expect(await store.listAudit()).toHaveLength(0);
  });

  it('allows enabling a non-risky flag and writes an audit record', async () => {
    const store = new InMemoryFlagStore();
    const rec = await enableFlag(store, clock, 'new_commerce_ui', 'op', 'ship');
    expect(rec).toEqual({ flag: 'new_commerce_ui', from: false, to: true, actor: 'op', reason: 'ship', at: AT });
    expect(await store.getState('new_commerce_ui')).toBe(true);
    const audit = await store.listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.flag).toBe('new_commerce_ui');
  });

  it('records from/to transitions across changes', async () => {
    const store = new InMemoryFlagStore();
    await setFlag(store, clock, 'staged_provider_rollout', true, 'op', 'on');
    const off = await setFlag(store, clock, 'staged_provider_rollout', false, 'op', 'off');
    expect(off.from).toBe(true);
    expect(off.to).toBe(false);
    expect(await store.listAudit()).toHaveLength(2);
  });
});

describe('environment force-off guard', () => {
  it('forces a hard-pinned flag OFF in production even if the store says ON', () => {
    const r = resolveFlag('live_provider_writes', true, 'production');
    expect(r.effective).toBe(false);
    expect(r.forcedOff).toBe(true);
    expect(r.reason).toMatch(/hard-pinned OFF in production/);
  });

  it('non-production can evaluate flags normally', () => {
    expect(resolveFlag('reporting_v2', true, 'staging').effective).toBe(true);
    expect(resolveFlag('new_commerce_ui', undefined, 'development').effective).toBe(true);
  });

  it('production default-OFF for risky flags when unset', () => {
    expect(resolveFlag('reporting_v2', undefined, 'production').effective).toBe(false);
    expect(resolveFlag('verbose_ops_logging', undefined, 'production').effective).toBe(true);
  });

  it('effectiveFlags force-pins all hard-pinned flags OFF in production', async () => {
    const store = new InMemoryFlagStore();
    const flags = await effectiveFlags(store, 'production');
    for (const f of flags) {
      if (isHardPinnedOff(f.key)) {
        expect(f.effective, f.key).toBe(false);
      }
    }
  });
});

describe('kill-flag', () => {
  it('disables any feature instantly, including a hard-pinned one, with a KILL audit', async () => {
    const store = new InMemoryFlagStore({ new_commerce_ui: true });
    const rec = await killFlag(store, clock, 'new_commerce_ui', 'oncall', 'incident 42');
    expect(rec.to).toBe(false);
    expect(rec.from).toBe(true);
    expect(rec.reason).toMatch(/^KILL:/);
    expect(await store.getState('new_commerce_ui')).toBe(false);
    // Kill works on a hard-pinned flag too (turning OFF is always safe).
    const rec2 = await killFlag(store, clock, 'live_provider_writes', 'oncall', 'belt-and-braces');
    expect(rec2.to).toBe(false);
  });
});
