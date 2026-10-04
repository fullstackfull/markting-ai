import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LocalKeyManager,
  ProductionKmsKeyManager,
  RevokedKeyVersionError,
} from '@/lib/markting/ops/key-management';

function localManager(): LocalKeyManager {
  return LocalKeyManager.fromKeys([{ version: 'v1', key: randomBytes(32), state: 'ACTIVE' }]);
}

describe('LocalKeyManager over the kms.ts envelope keyring', () => {
  it('round-trips encrypt → decrypt without persisting plaintext', () => {
    const km = localManager();
    const sealed = km.encrypt('whsec_provider_token');
    // The sealed blob exposes no plaintext.
    expect(JSON.stringify(sealed)).not.toContain('whsec_provider_token');
    expect(km.decrypt(sealed)).toBe('whsec_provider_token');
  });

  it('carries the sealing key version in the blob and reports it via version()', () => {
    const km = localManager();
    const sealed = km.encrypt('s');
    expect(sealed.keyVersion).toBe('v1');
    expect(km.version(sealed)).toBe('v1');
  });

  it('rotate keeps old-version blobs decryptable and seals new writes under the new key', () => {
    const km = localManager();
    const oldSealed = km.encrypt('old-secret');
    expect(km.version(oldSealed)).toBe('v1');

    km.rotate({ version: 'v2', key: randomBytes(32) });

    // Old blob (v1) still decrypts — PREVIOUS key is decrypt-only, no downtime.
    expect(km.decrypt(oldSealed)).toBe('old-secret');

    // New writes use the new ACTIVE key version.
    const newSealed = km.encrypt('new-secret');
    expect(km.version(newSealed)).toBe('v2');
    expect(km.decrypt(newSealed)).toBe('new-secret');
  });

  it('revoke blocks decrypt of anything sealed under the revoked version', () => {
    const km = localManager();
    const sealed = km.encrypt('revoke-me');
    expect(km.decrypt(sealed)).toBe('revoke-me'); // readable before revocation

    km.revoke('v1');

    expect(km.isRevoked('v1')).toBe(true);
    expect(() => km.decrypt(sealed)).toThrow(RevokedKeyVersionError);
    expect(() => km.decrypt(sealed)).toThrow(/revoked/);
  });

  it('revoking one version does not block a different active version', () => {
    const km = localManager();
    const v1Sealed = km.encrypt('first');
    km.rotate({ version: 'v2', key: randomBytes(32) });
    const v2Sealed = km.encrypt('second');

    km.revoke('v1');

    expect(() => km.decrypt(v1Sealed)).toThrow(RevokedKeyVersionError);
    expect(km.decrypt(v2Sealed)).toBe('second'); // v2 unaffected
  });

  it('decrypt throws (secret-free) for an unknown key version', () => {
    const km = localManager();
    const sealed = km.encrypt('x');
    expect(() => km.decrypt({ ...sealed, keyVersion: 'v-does-not-exist' })).toThrow(
      /not in the keyring/,
    );
  });
});

describe('ProductionKmsKeyManager (BLOCKED_EXTERNAL adapter boundary)', () => {
  it('blocks every key-service operation with a BLOCKED_EXTERNAL error', () => {
    const km = new ProductionKmsKeyManager();
    expect(() => km.encrypt('s')).toThrow(/BLOCKED_EXTERNAL/);
    expect(() => km.decrypt({ keyVersion: 'v1', iv: '', tag: '', wrappedDataKey: '', ciphertext: '' })).toThrow(
      /BLOCKED_EXTERNAL/,
    );
    expect(() => km.rotate({ version: 'v2', key: randomBytes(32) })).toThrow(/BLOCKED_EXTERNAL/);
    expect(() => km.revoke('v1')).toThrow(/BLOCKED_EXTERNAL/);
  });

  it('reads the version out of a blob without needing the key service', () => {
    const km = new ProductionKmsKeyManager();
    expect(
      km.version({ keyVersion: 'v7', iv: '', tag: '', wrappedDataKey: '', ciphertext: '' }),
    ).toBe('v7');
  });
});
