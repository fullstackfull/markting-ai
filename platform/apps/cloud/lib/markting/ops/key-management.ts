/**
 * PHASE C.6 (14) — KEY MANAGEMENT ABSTRACTION.
 *
 * A small seam over the EXISTING rotation-safe envelope crypto in `kms.ts`. It exposes the operations
 * a caller needs for provider + webhook secrets — encrypt / decrypt / rotate / version / revoke —
 * WITHOUT re-implementing any cryptography. `LocalKeyManager` is the software implementation used in
 * dev and tests; it delegates all sealing/opening to `kms.ts`'s AES-256-GCM keyring.
 *
 * Security invariants (inherited from kms.ts, never weakened here):
 *   - Only SEALED blobs are produced; no plaintext is persisted or logged.
 *   - Rotation keeps PREVIOUS key versions decrypt-only, so existing blobs stay readable with no
 *     downtime; new writes always use the ACTIVE key.
 *   - A sealed blob carries the key version that sealed it (`SealedSecret.keyVersion`).
 *   - Revoking a key version refuses DECRYPT of anything sealed under it, independently of whether the
 *     version is still present in the keyring.
 *
 * BLOCKED_EXTERNAL: a real cloud KMS key service is absent in this environment. `ProductionKmsKeyManager`
 * is the adapter boundary for it (interface/stub). Wiring it to a live KMS endpoint — so master keys are
 * KMS-backed rather than in-process — is a deploy step, not something that can run here.
 */
import { KeyRing, seal, open, type SealedSecret, type MasterKey } from './kms';

export type { SealedSecret } from './kms';

/**
 * The key-management seam. Implementations seal/open secrets and manage the underlying key versions.
 * Synchronous, matching the in-process envelope crypto in kms.ts; a production KMS adapter performs its
 * key-service calls behind this same shape (see ProductionKmsKeyManager).
 */
export interface KeyManager {
  /** Seal a plaintext secret under the ACTIVE key version. Returns a sealed blob — never plaintext. */
  encrypt(plaintext: string): SealedSecret;
  /** Open a sealed blob. Throws if its key version is unknown or has been revoked. */
  decrypt(sealed: SealedSecret): string;
  /** Rotate in a new ACTIVE key; the former ACTIVE becomes PREVIOUS (decrypt-only). */
  rotate(next: { version: string; key: Buffer }): void;
  /** The key version that sealed a given blob (the version carried inside the blob). */
  version(sealed: SealedSecret): string;
  /** Mark a key version revoked. Decrypt of anything sealed under it is thereafter refused. */
  revoke(version: string): void;
}

/** Thrown when a decrypt is refused because the sealing key version was revoked. */
export class RevokedKeyVersionError extends Error {
  constructor(public readonly keyVersion: string) {
    super(`key version ${keyVersion} is revoked — decrypt refused`);
    this.name = 'RevokedKeyVersionError';
  }
}

/**
 * Software KeyManager over the kms.ts AES-256-GCM keyring. All crypto is delegated to kms.ts; this class
 * only tracks which key versions have been revoked. In production the keyring's master keys would be
 * KMS-backed (see ProductionKmsKeyManager); the envelope algorithm is identical.
 */
export class LocalKeyManager implements KeyManager {
  private readonly ring: KeyRing;
  private readonly revoked = new Set<string>();

  constructor(ring: KeyRing) {
    this.ring = ring;
  }

  /** Convenience constructor from the raw master key material. */
  static fromKeys(keys: MasterKey[]): LocalKeyManager {
    return new LocalKeyManager(new KeyRing(keys));
  }

  encrypt(plaintext: string): SealedSecret {
    // Sealing always uses the ACTIVE key version (enforced inside kms.ts seal()).
    return seal(this.ring, plaintext);
  }

  decrypt(sealed: SealedSecret): string {
    if (this.revoked.has(sealed.keyVersion)) throw new RevokedKeyVersionError(sealed.keyVersion);
    return open(this.ring, sealed);
  }

  rotate(next: { version: string; key: Buffer }): void {
    this.ring.rotate(next);
  }

  version(sealed: SealedSecret): string {
    return sealed.keyVersion;
  }

  revoke(version: string): void {
    this.revoked.add(version);
  }

  /** Whether a key version has been revoked (exposed for callers that audit key state). */
  isRevoked(version: string): boolean {
    return this.revoked.has(version);
  }
}

/**
 * BLOCKED_EXTERNAL — production KMS key-manager adapter boundary.
 *
 * In production, master keys live in a cloud KMS key service: this adapter would call that service to
 * wrap/unwrap data keys (the envelope algorithm stays the one in kms.ts). No KMS endpoint exists in this
 * environment, so every operation throws. Replace this with a real KMS client as a deploy step; do NOT
 * fall back to in-process keys for production — that is what LocalKeyManager is for (dev/tests only).
 */
export class ProductionKmsKeyManager implements KeyManager {
  private static blocked(op: string): never {
    throw new Error(
      `BLOCKED_EXTERNAL: ProductionKmsKeyManager.${op} requires a live KMS key service, which is absent ` +
        `in this environment. Wiring a real KMS endpoint is a deploy step. Use LocalKeyManager for dev/tests.`,
    );
  }

  encrypt(_plaintext: string): SealedSecret {
    return ProductionKmsKeyManager.blocked('encrypt');
  }

  decrypt(_sealed: SealedSecret): string {
    return ProductionKmsKeyManager.blocked('decrypt');
  }

  rotate(_next: { version: string; key: Buffer }): void {
    ProductionKmsKeyManager.blocked('rotate');
  }

  version(sealed: SealedSecret): string {
    // The version is carried in the blob itself, so this one op needs no key service — it is safe and
    // useful even without a KMS endpoint (e.g. to audit which version sealed a stored blob).
    return sealed.keyVersion;
  }

  revoke(_version: string): void {
    ProductionKmsKeyManager.blocked('revoke');
  }
}
