import { describe, expect, it } from 'vitest';
import {
  TokenRefreshEngine,
  TokenRevokedError,
  isRefreshNeeded,
  isTokenExpired,
  type RefreshResult,
  type TokenRefresher,
  type TokenState,
} from '@/lib/markting/ops/token-refresh';

/**
 * PHASE C.6 (15) — provider-neutral token refresh engine. A FAKE TokenRefresher port stands in for live
 * OAuth (no credentials, no network); the live HTTP refresh is BLOCKED_EXTERNAL. The clock is injected so
 * expiry/skew/cooldown are deterministic.
 */

const T0 = 1_000_000_000_000; // fixed epoch ms

/** A controllable fake refresher: counts calls and can be made to resolve, fail, or report revocation. */
function fakeRefresher(opts: {
  mode?: 'ok' | 'fail' | 'revoked';
  /** A gate the test resolves to let the in-flight refresh complete (for single-flight timing). */
  gate?: Promise<void>;
  result?: Partial<RefreshResult>;
} = {}): { refresher: TokenRefresher; calls: () => number } {
  let calls = 0;
  const refresher: TokenRefresher = async (state) => {
    calls += 1;
    if (opts.gate) await opts.gate;
    if (opts.mode === 'revoked') throw new TokenRevokedError();
    if (opts.mode === 'fail') throw new Error('provider 500');
    return {
      accessToken: opts.result?.accessToken ?? 'new-access',
      expiresAt: opts.result?.expiresAt ?? T0 + 3_600_000,
      refreshToken: opts.result?.refreshToken ?? state.refreshToken ?? undefined,
    };
  };
  return { refresher, calls: () => calls };
}

describe('expiry detection with skew', () => {
  it('treats a token expiring within the skew window as expired', () => {
    const state: TokenState = { expiresAt: T0 + 30_000, refreshToken: 'r' };
    expect(isTokenExpired(state, T0, 60_000)).toBe(true); // within 60s skew
    expect(isTokenExpired(state, T0, 10_000)).toBe(false); // outside 10s skew
  });

  it('treats an absent expiry as already expired', () => {
    expect(isTokenExpired({ refreshToken: 'r' }, T0, 60_000)).toBe(true);
    expect(isTokenExpired({ expiresAt: null, refreshToken: 'r' }, T0, 0)).toBe(true);
  });

  it('refresh is needed only when near-expiry, refreshable, and not revoked', () => {
    const near: TokenState = { expiresAt: T0 + 1_000, refreshToken: 'r' };
    expect(isRefreshNeeded(near, T0, 60_000)).toBe(true);
    expect(isRefreshNeeded({ ...near, refreshToken: null }, T0, 60_000)).toBe(false); // not refreshable
    expect(isRefreshNeeded({ ...near, revoked: true }, T0, 60_000)).toBe(false); // revoked
    expect(isRefreshNeeded({ expiresAt: T0 + 3_600_000, refreshToken: 'r' }, T0, 60_000)).toBe(false); // still fresh
  });
});

describe('ensureFresh decisions', () => {
  it('returns FRESH without calling the refresher when the token is valid', async () => {
    const fake = fakeRefresher();
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const out = await engine.ensureFresh({ expiresAt: T0 + 3_600_000, refreshToken: 'r' });
    expect(out.status).toBe('FRESH');
    expect(out.nextConnectionState).toBe('CONNECTED');
    expect(fake.calls()).toBe(0);
  });

  it('refreshes a near-expiry token and returns the new state', async () => {
    const fake = fakeRefresher({ result: { accessToken: 'fresh', expiresAt: T0 + 7_200_000 } });
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const out = await engine.ensureFresh({ expiresAt: T0 + 1_000, refreshToken: 'r' });
    expect(out.status).toBe('REFRESHED');
    expect(out.state.accessToken).toBe('fresh');
    expect(out.state.expiresAt).toBe(T0 + 7_200_000);
    expect(out.nextConnectionState).toBe('CONNECTED');
    expect(fake.calls()).toBe(1);
  });

  it('preserves the existing refresh token when the provider does not rotate it', async () => {
    const fake = fakeRefresher({ result: { refreshToken: undefined } });
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const out = await engine.ensureFresh({ expiresAt: T0, refreshToken: 'keep-me' });
    expect(out.state.refreshToken).toBe('keep-me');
  });
});

describe('single-flight refresh lock', () => {
  it('runs ONE refresh for N concurrent callers and shares the outcome', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fake = fakeRefresher({ gate });
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const expiring: TokenState = { expiresAt: T0, refreshToken: 'r' };

    // Fire 8 concurrent callers before the (gated) refresh can resolve.
    const callers = Array.from({ length: 8 }, () => engine.ensureFresh(expiring));
    release();
    const outcomes = await Promise.all(callers);

    expect(fake.calls()).toBe(1); // exactly one provider call, no stampede
    for (const out of outcomes) {
      expect(out.status).toBe('REFRESHED');
      expect(out.state.accessToken).toBe('new-access');
    }
  });

  it('allows a fresh refresh after the previous one settled', async () => {
    const fake = fakeRefresher();
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    await engine.ensureFresh({ expiresAt: T0, refreshToken: 'r' });
    await engine.ensureFresh({ expiresAt: T0, refreshToken: 'r' });
    expect(fake.calls()).toBe(2); // the lock cleared between sequential cycles
  });
});

describe('failure → reauth + cooldown', () => {
  it('maps a refresh failure to REAUTH_REQUIRED and opens a cooldown', async () => {
    let clock = T0;
    const fake = fakeRefresher({ mode: 'fail' });
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, cooldownMs: 30_000, now: () => clock });
    const expiring: TokenState = { expiresAt: T0, refreshToken: 'r' };

    const first = await engine.ensureFresh(expiring);
    expect(first.status).toBe('REAUTH_REQUIRED');
    expect(first.nextConnectionState).toBe('REAUTH_REQUIRED');
    expect(fake.calls()).toBe(1);
    expect(engine.inCooldown()).toBe(true);

    // Within the cooldown window the provider is NOT called again.
    clock = T0 + 10_000;
    const during = await engine.ensureFresh(expiring);
    expect(during.status).toBe('COOLDOWN');
    expect(during.nextConnectionState).toBe('EXPIRED');
    expect(fake.calls()).toBe(1);

    // After the cooldown elapses, a new attempt is allowed.
    clock = T0 + 30_001;
    const after = await engine.ensureFresh(expiring);
    expect(after.status).toBe('REAUTH_REQUIRED');
    expect(fake.calls()).toBe(2);
  });

  it('a successful refresh clears any prior cooldown', async () => {
    let clock = T0;
    let mode: 'ok' | 'fail' = 'fail';
    const refresher: TokenRefresher = async (state) => {
      if (mode === 'fail') throw new Error('transient');
      return { accessToken: 'ok', expiresAt: clock + 3_600_000, refreshToken: state.refreshToken ?? undefined };
    };
    const engine = new TokenRefreshEngine({ refresher, cooldownMs: 30_000, now: () => clock });
    const expiring: TokenState = { expiresAt: T0, refreshToken: 'r' };

    await engine.ensureFresh(expiring);
    expect(engine.inCooldown()).toBe(true);
    clock = T0 + 30_001;
    mode = 'ok';
    const ok = await engine.ensureFresh(expiring);
    expect(ok.status).toBe('REFRESHED');
    expect(engine.inCooldown()).toBe(false);
  });
});

describe('revocation handling', () => {
  it('never refreshes an already-revoked grant — goes straight to reauth', async () => {
    const fake = fakeRefresher();
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const out = await engine.ensureFresh({ expiresAt: T0, refreshToken: 'r', revoked: true });
    expect(out.status).toBe('REAUTH_REQUIRED');
    expect(fake.calls()).toBe(0); // no provider call for a revoked grant
  });

  it('handles the provider reporting revocation during refresh without opening a cooldown', async () => {
    const fake = fakeRefresher({ mode: 'revoked' });
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const out = await engine.ensureFresh({ expiresAt: T0, refreshToken: 'r' });
    expect(out.status).toBe('REAUTH_REQUIRED');
    expect(out.state.revoked).toBe(true);
    expect(engine.inCooldown()).toBe(false); // revocation is terminal, not a retry-with-backoff
  });

  it('reauthorizes when the token is expired and there is no refresh token', async () => {
    const fake = fakeRefresher();
    const engine = new TokenRefreshEngine({ refresher: fake.refresher, now: () => T0 });
    const out = await engine.ensureFresh({ expiresAt: T0 - 1, refreshToken: null });
    expect(out.status).toBe('REAUTH_REQUIRED');
    expect(fake.calls()).toBe(0);
  });
});

describe('BLOCKED_EXTERNAL', () => {
  it('documents that the live OAuth refresh is intentionally not exercised here', () => {
    // A real TokenRefresher would POST to the provider token endpoint with a client secret + refresh
    // token. That requires credentials and network egress and is BLOCKED_EXTERNAL in this suite; the
    // engine is verified end-to-end against the injected fake port above. This test documents the
    // boundary so the omission is explicit, not accidental — the engine never performs I/O itself.
    const engine = new TokenRefreshEngine({ refresher: async () => { throw new Error('unreachable'); }, now: () => T0 });
    expect(engine).toBeInstanceOf(TokenRefreshEngine);
  });
});
