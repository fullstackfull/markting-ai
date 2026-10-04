import { describe, expect, it } from 'vitest';
import {
  CONNECTION_LIFECYCLE_STATES,
  IllegalConnectionTransitionError,
  allowedTransitions,
  assertConnectionTransition,
  canTransition,
  isRestingState,
  transitionConnection,
  type ConnectionLifecycleState,
} from '@/lib/markting/ops/connection-state-machine';
import {
  RECOVERY_ACTIONS,
  RECOVERY_CONDITIONS,
  recommendRecovery,
  recoveryPermitsExecution,
} from '@/lib/markting/ops/connection-recovery';

/**
 * PHASE C.6 (17) — connection lifecycle state machine. Legal transitions are honored and produce an
 * auditable event; illegal ones are refused server-side. Credential-free and deterministic (clock injected).
 */

const FIXED_NOW = Date.parse('2026-01-02T03:04:05.000Z');
const clock = () => FIXED_NOW;

describe('legal transitions', () => {
  it('moves NOT_CONFIGURED → CONNECTING → CONNECTED (the happy path)', () => {
    expect(canTransition('NOT_CONFIGURED', 'CONNECTING')).toBe(true);
    expect(canTransition('CONNECTING', 'CONNECTED')).toBe(true);
  });

  it('returns a copy of the allowed next states, not the backing array', () => {
    const a = allowedTransitions('CONNECTED');
    a.push('NOT_CONFIGURED');
    expect(allowedTransitions('CONNECTED')).not.toContain('NOT_CONFIGURED');
  });

  it('allows recovery from DEGRADED/ERROR back to CONNECTED', () => {
    expect(canTransition('DEGRADED', 'CONNECTED')).toBe(true);
    expect(canTransition('ERROR', 'CONNECTED')).toBe(true);
  });

  it('routes EXPIRED and REAUTH_REQUIRED back through CONNECTING, never a silent revival', () => {
    expect(canTransition('EXPIRED', 'CONNECTING')).toBe(true);
    expect(canTransition('REAUTH_REQUIRED', 'CONNECTING')).toBe(true);
    expect(canTransition('EXPIRED', 'CONNECTED')).toBe(false);
    expect(canTransition('REAUTH_REQUIRED', 'CONNECTED')).toBe(false);
  });
});

describe('illegal transitions', () => {
  it('refuses NOT_CONFIGURED → CONNECTED (must go through CONNECTING)', () => {
    expect(canTransition('NOT_CONFIGURED', 'CONNECTED')).toBe(false);
    expect(() => assertConnectionTransition('NOT_CONFIGURED', 'CONNECTED')).toThrow(IllegalConnectionTransitionError);
  });

  it('refuses REVOKED → CONNECTED (a fresh authorization is required)', () => {
    expect(canTransition('REVOKED', 'CONNECTED')).toBe(false);
    expect(() => assertConnectionTransition('REVOKED', 'CONNECTED')).toThrow(/illegal connection transition REVOKED → CONNECTED/);
  });

  it('refuses DISABLED → CONNECTED (an operator hold resumes via re-verification)', () => {
    expect(canTransition('DISABLED', 'CONNECTED')).toBe(false);
  });

  it('rejects a self-transition that is not declared legal', () => {
    expect(canTransition('CONNECTED', 'CONNECTED')).toBe(false);
  });
});

describe('transitionConnection emits an auditable event', () => {
  it('returns {from,to,reason,at} on a legal move', () => {
    const event = transitionConnection('CONNECTED', 'DEGRADED', 'elevated error rate', { now: clock });
    expect(event).toEqual({
      from: 'CONNECTED',
      to: 'DEGRADED',
      reason: 'elevated error rate',
      at: new Date(FIXED_NOW).toISOString(),
    });
  });

  it('throws on an illegal move and emits no event', () => {
    expect(() => transitionConnection('REVOKED', 'CONNECTED', 'nope', { now: clock })).toThrow(IllegalConnectionTransitionError);
  });
});

describe('full lifecycle walk', () => {
  it('connect → degrade → expire → reauthorize → reconnect → revoke → reconnect → disable', () => {
    const path: Array<[ConnectionLifecycleState, ConnectionLifecycleState]> = [
      ['NOT_CONFIGURED', 'CONNECTING'],
      ['CONNECTING', 'CONNECTED'],
      ['CONNECTED', 'DEGRADED'],
      ['DEGRADED', 'EXPIRED'],
      ['EXPIRED', 'REAUTH_REQUIRED'],
      ['REAUTH_REQUIRED', 'CONNECTING'],
      ['CONNECTING', 'CONNECTED'],
      ['CONNECTED', 'REVOKED'],
      ['REVOKED', 'CONNECTING'],
      ['CONNECTING', 'CONNECTED'],
      ['CONNECTED', 'DISABLED'],
    ];
    for (const [from, to] of path) {
      expect(() => transitionConnection(from, to, 'walk', { now: clock })).not.toThrow();
    }
  });

  it('every declared transition target is itself a canonical state', () => {
    for (const from of CONNECTION_LIFECYCLE_STATES) {
      for (const to of allowedTransitions(from)) {
        expect(CONNECTION_LIFECYCLE_STATES).toContain(to);
      }
    }
  });
});

describe('resting states', () => {
  it('classifies the no-in-flight-work states', () => {
    expect(isRestingState('NOT_CONFIGURED')).toBe(true);
    expect(isRestingState('DISCONNECTED')).toBe(true);
    expect(isRestingState('REVOKED')).toBe(true);
    expect(isRestingState('DISABLED')).toBe(true);
    expect(isRestingState('CONNECTED')).toBe(false);
    expect(isRestingState('CONNECTING')).toBe(false);
  });
});

/**
 * PHASE C.6 (18) — connection recovery policy. A deterministic condition → {action,nextState} map whose
 * target states tie back to the state machine above. No model, no heuristics.
 */
describe('connection recovery mapping', () => {
  it('maps every condition to the specified action + target state', () => {
    expect(recommendRecovery('AUTH_ERROR')).toMatchObject({ action: 'REAUTHORIZE', nextState: 'REAUTH_REQUIRED' });
    expect(recommendRecovery('TOKEN_EXPIRED')).toMatchObject({ action: 'REFRESH_OR_REAUTH', nextState: 'EXPIRED' });
    expect(recommendRecovery('RATE_LIMIT')).toMatchObject({ action: 'BACKOFF', nextState: 'DEGRADED' });
    expect(recommendRecovery('SCHEMA_CHANGED')).toMatchObject({ action: 'QUARANTINE_AND_ALERT', nextState: 'ERROR' });
    expect(recommendRecovery('SYNC_FAILED')).toMatchObject({ action: 'RETRY', nextState: 'DEGRADED' });
    expect(recommendRecovery('DISABLED')).toMatchObject({ action: 'NO_EXECUTION', nextState: 'DISABLED' });
  });

  it('is exhaustive, deterministic, and uses only canonical actions', () => {
    for (const condition of RECOVERY_CONDITIONS) {
      const a = recommendRecovery(condition);
      const b = recommendRecovery(condition);
      expect(a).toEqual(b); // deterministic
      expect(RECOVERY_ACTIONS).toContain(a.action);
      expect(a.reason.length).toBeGreaterThan(0);
    }
  });

  it('only DISABLED forbids any execution/recovery attempt', () => {
    expect(recoveryPermitsExecution('DISABLED')).toBe(false);
    for (const condition of RECOVERY_CONDITIONS.filter((c) => c !== 'DISABLED')) {
      expect(recoveryPermitsExecution(condition)).toBe(true);
    }
  });

  it('every recovery target state is reachable from CONNECTED (ties to the state machine)', () => {
    for (const condition of RECOVERY_CONDITIONS) {
      const { nextState } = recommendRecovery(condition);
      expect(canTransition('CONNECTED', nextState)).toBe(true);
    }
  });
});
