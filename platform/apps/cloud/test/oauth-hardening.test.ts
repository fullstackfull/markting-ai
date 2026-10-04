import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPkce, buildGoogleAuthorizationUrl } from '@/lib/cloud/google-oauth';
import { oauthRedirectUri } from '@/lib/cloud/provider-oauth';
import { isOAuthProvider } from '@/lib/cloud/types';
import { safeReturnPath } from '@/lib/return-path';
import { digestState } from '@/lib/crypto';
import { resetEnvForTests } from '@/lib/env';
import {
  accountDiscoveryAllowed,
  evaluateCallbackBinding,
  type OAuthCallbackClaim,
  type OAuthStateRecord,
} from '@/lib/markting/ops/connection-state-machine';

/**
 * PHASE C.6 (16) — OAUTH CALLBACK HARDENING.
 *
 * These tests exercise the REAL, credential-free guard primitives the hosted OAuth broker uses:
 *   - createPkce / buildGoogleAuthorizationUrl (lib/cloud/google-oauth.ts)   — PKCE S256
 *   - digestState (lib/crypto.ts)                                            — single-use state binding
 *   - oauthRedirectUri (lib/cloud/provider-oauth.ts)                         — callback origin anchoring
 *   - safeReturnPath (lib/return-path.ts)                                    — open-redirect defense
 *   - isOAuthProvider (lib/cloud/types.ts)                                   — provider validation
 * plus the pure callback-binding guard (evaluateCallbackBinding / accountDiscoveryAllowed) that models the
 * invariants enforced authoritatively by the DB-backed consumeOAuthTransaction (user/tenant/provider
 * binding, single-use replay, expiry).
 *
 * BLOCKED_EXTERNAL: the live authorization-code → token exchange (adapter.exchange) and the DB-backed
 * transaction consume require provider credentials + Postgres + a real session. They are NOT invoked here;
 * the pure guards that gate the CONNECTING → CONNECTED transition are tested instead.
 */

const T0 = Date.parse('2026-01-02T00:00:00.000Z');

beforeEach(() => {
  process.env.GOOGLE_ADS_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_ADS_CLIENT_SECRET = 'test-client-secret';
  process.env.ADPORT_CLOUD_BASE_URL = 'https://app.adport.test';
  resetEnvForTests();
});

describe('PKCE verifier/challenge', () => {
  it('derives the challenge as base64url(SHA-256(verifier)) — S256', () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier).not.toBe(challenge);
  });

  it('mints a fresh, high-entropy verifier each time', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('puts the S256 challenge + state on the authorization URL (never the verifier)', () => {
    const { verifier, challenge } = createPkce();
    const url = new URL(buildGoogleAuthorizationUrl({ state: 'state-xyz', challenge }));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.toString()).not.toContain(verifier); // the verifier never leaves the server
  });
});

describe('state binding (single-use hash)', () => {
  it('hashes state deterministically so the stored row is found by hash, not raw state', () => {
    expect(digestState('abc')).toBe(digestState('abc'));
    expect(digestState('abc')).not.toBe(digestState('abd'));
    // The raw state is never stored — only its digest.
    expect(digestState('secret-state')).not.toContain('secret-state');
  });
});

describe('callback origin check', () => {
  it('anchors the redirect URI to the configured public origin, not an inbound Host', () => {
    const uri = oauthRedirectUri('google');
    expect(uri).toBe('https://app.adport.test/api/oauth/google/callback');
    expect(new URL(uri).origin).toBe('https://app.adport.test');
  });

  it('refuses open-redirect return paths and keeps only same-origin relative paths', () => {
    expect(safeReturnPath('/dashboard/connections')).toBe('/dashboard/connections');
    expect(safeReturnPath('//evil.example.com')).toBe('/dashboard');
    expect(safeReturnPath('https://evil.example.com/x')).toBe('/dashboard');
    expect(safeReturnPath('/a\\b')).toBe('/dashboard');
    expect(safeReturnPath(null)).toBe('/dashboard');
  });
});

describe('provider mismatch rejection', () => {
  it('accepts only known OAuth providers', () => {
    expect(isOAuthProvider('google')).toBe(true);
    expect(isOAuthProvider('meta')).toBe(true);
    expect(isOAuthProvider('evil-provider')).toBe(false);
    expect(isOAuthProvider('')).toBe(false);
  });
});

describe('callback binding guard', () => {
  const record: OAuthStateRecord = {
    provider: 'google',
    userId: 'user-1',
    organizationId: 'org-1',
    stateHash: digestState('the-state'),
    consumedAt: null,
    expiresAt: T0 + 10 * 60_000, // +10 minutes, matching the start route
  };
  const baseClaim: OAuthCallbackClaim = {
    provider: 'google',
    userId: 'user-1',
    organizationId: 'org-1',
    stateHash: digestState('the-state'),
    originOk: true,
  };
  const now = () => T0;

  it('accepts a correctly bound, unused, unexpired callback', () => {
    expect(evaluateCallbackBinding(record, baseClaim, { now })).toEqual({ ok: true, reason: 'OK' });
  });

  it('rejects an untrusted callback origin before any lookup', () => {
    expect(evaluateCallbackBinding(record, { ...baseClaim, originOk: false }, { now })).toEqual({ ok: false, reason: 'ORIGIN_REJECTED' });
  });

  it('rejects an unknown/forged state (no matching record)', () => {
    expect(evaluateCallbackBinding(null, baseClaim, { now })).toEqual({ ok: false, reason: 'UNKNOWN_STATE' });
    const wrong = { ...baseClaim, stateHash: digestState('different-state') };
    expect(evaluateCallbackBinding(record, wrong, { now })).toEqual({ ok: false, reason: 'UNKNOWN_STATE' });
  });

  it('resists replay — a consumed state cannot be reused', () => {
    const consumed = { ...record, consumedAt: T0 - 1_000 };
    expect(evaluateCallbackBinding(consumed, baseClaim, { now })).toEqual({ ok: false, reason: 'STATE_REUSED' });
  });

  it('rejects an expired state', () => {
    expect(evaluateCallbackBinding(record, baseClaim, { now: () => record.expiresAt })).toEqual({ ok: false, reason: 'STATE_EXPIRED' });
    expect(evaluateCallbackBinding(record, baseClaim, { now: () => record.expiresAt + 1 })).toEqual({ ok: false, reason: 'STATE_EXPIRED' });
  });

  it('enforces provider binding', () => {
    expect(evaluateCallbackBinding(record, { ...baseClaim, provider: 'meta' }, { now })).toEqual({ ok: false, reason: 'PROVIDER_MISMATCH' });
  });

  it('enforces user binding (session may have changed on the consent screen)', () => {
    expect(evaluateCallbackBinding(record, { ...baseClaim, userId: 'user-2' }, { now })).toEqual({ ok: false, reason: 'USER_MISMATCH' });
  });

  it('enforces tenant binding', () => {
    expect(evaluateCallbackBinding(record, { ...baseClaim, organizationId: 'org-2' }, { now })).toEqual({ ok: false, reason: 'ORG_MISMATCH' });
  });

  it('gates account discovery on an OK binding AND a stored grant', () => {
    const ok = evaluateCallbackBinding(record, baseClaim, { now });
    const rejected = evaluateCallbackBinding(record, { ...baseClaim, userId: 'user-2' }, { now });
    expect(accountDiscoveryAllowed(ok, true)).toBe(true);
    expect(accountDiscoveryAllowed(ok, false)).toBe(false); // no grant stored yet
    expect(accountDiscoveryAllowed(rejected, true)).toBe(false); // never discover after a rejected binding
  });
});
