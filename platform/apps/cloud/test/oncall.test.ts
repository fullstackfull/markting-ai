import { describe, expect, it } from 'vitest';
import {
  StaticOnCallResolver,
  NoopOnCallResolver,
  type OnCallResolver,
} from '@/lib/markting/ops/oncall';

const NOW = 6_000_000;

describe('C.6-21 — on-call abstraction', () => {
  it('StaticOnCallResolver returns the configured assignment for a SEV', () => {
    const resolver: OnCallResolver = new StaticOnCallResolver({
      SEV1: { operatorId: 'op_commander', displayName: 'Ada Commander' },
      SEV2: { operatorId: 'op_senior', displayName: 'Bo Senior', operatorRole: 'custom_role' },
    });

    const a = resolver.resolve('SEV1', NOW);
    expect(a).toEqual({
      sev: 'SEV1',
      operatorRole: 'incident_commander', // defaulted from the escalation policy
      operatorId: 'op_commander',
      displayName: 'Ada Commander',
      resolvedAtMs: NOW,
    });

    // an explicit role override wins over the policy default
    expect(resolver.resolve('SEV2', NOW)?.operatorRole).toBe('custom_role');
  });

  it('StaticOnCallResolver returns null for a SEV with no configured assignee', () => {
    const resolver = new StaticOnCallResolver({ SEV1: { operatorId: 'op1', displayName: 'One' } });
    expect(resolver.resolve('SEV4', NOW)).toBeNull();
  });

  it('NoopOnCallResolver always returns null (safe fallback)', () => {
    const resolver: OnCallResolver = new NoopOnCallResolver();
    expect(resolver.resolve('SEV1', NOW)).toBeNull();
    expect(resolver.resolve('SEV4', NOW + 1000)).toBeNull();
  });
});
