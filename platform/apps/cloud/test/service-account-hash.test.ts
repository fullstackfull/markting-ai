import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authenticateServiceKey, mintServiceKey, type ServiceAccount } from '@/lib/markting/ops/service-account';
import { digestApiKey } from '@/lib/crypto';

/**
 * WAVE 0.2 — service-account credential hashing regression. The stored hash must be a peppered HMAC
 * (server-secret keyed), NOT an unsalted SHA-256, and verification must be constant-time and fail
 * closed on a wrong key. No plaintext secret is persisted (mint returns the hash, never stores raw).
 */
const account: ServiceAccount = {
  id: 'sa_1', organizationId: 'org_1', name: 'ci', keyPrefix: 'mk_', scopes: ['tools:read'], isServiceAccount: true,
};

describe('WAVE 0.2 service-account hashing', () => {
  it('stored hash is the peppered HMAC, not a bare sha256 of the plaintext', () => {
    const { plaintext, secretHash } = mintServiceKey();
    expect(secretHash).toBe(digestApiKey(plaintext));
    expect(secretHash).not.toBe(createHash('sha256').update(plaintext).digest('hex'));
  });

  it('authenticates the correct key and fails closed on a wrong/forged key', () => {
    const { plaintext, secretHash } = mintServiceKey();
    expect(authenticateServiceKey({ presented: plaintext, account, storedHash: secretHash, requiredScope: 'tools:read' }).ok).toBe(true);
    expect(authenticateServiceKey({ presented: `${plaintext}x`, account, storedHash: secretHash, requiredScope: 'tools:read' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    // A different minted key must not authenticate against this account's stored hash.
    const other = mintServiceKey();
    expect(authenticateServiceKey({ presented: other.plaintext, account, storedHash: secretHash, requiredScope: 'tools:read' }).ok).toBe(false);
  });

  it('missing account or stored hash fails closed', () => {
    const { plaintext } = mintServiceKey();
    expect(authenticateServiceKey({ presented: plaintext, account: null, storedHash: null, requiredScope: 'tools:read' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
