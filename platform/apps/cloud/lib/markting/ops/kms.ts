/**
 * Phase 7K — SECRETS / KMS envelope encryption, ROTATION-SAFE. Each secret is sealed with a per-record
 * data key, which is itself wrapped by a VERSIONED master key. New writes use the ACTIVE master key;
 * PREVIOUS versions are retained for DECRYPT so rotation needs no downtime and existing tokens stay
 * readable. A real cloud KMS is BLOCKED_EXTERNAL here; this is a correct software envelope whose master
 * keys would be KMS-backed in production. No plaintext secret is ever persisted or logged.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto';

export interface MasterKey { version: string; key: Buffer; state: 'ACTIVE' | 'PREVIOUS' }

/** A keyring: exactly one ACTIVE key (used for new writes) + any number of PREVIOUS keys (decrypt-only). */
export class KeyRing {
  private keys = new Map<string, MasterKey>();
  constructor(keys: MasterKey[]) { for (const k of keys) this.keys.set(k.version, k); this.assertOneActive(); }
  private assertOneActive(): void {
    const active = [...this.keys.values()].filter((k) => k.state === 'ACTIVE');
    if (active.length !== 1) throw new Error(`keyring must have exactly one ACTIVE key, found ${active.length}`);
  }
  active(): MasterKey { return [...this.keys.values()].find((k) => k.state === 'ACTIVE')!; }
  get(version: string): MasterKey | undefined { return this.keys.get(version); }
  /** Rotate: a new ACTIVE key is added; the former ACTIVE becomes PREVIOUS (still decrypts old data). */
  rotate(next: { version: string; key: Buffer }): void {
    for (const k of this.keys.values()) if (k.state === 'ACTIVE') k.state = 'PREVIOUS';
    this.keys.set(next.version, { version: next.version, key: next.key, state: 'ACTIVE' });
    this.assertOneActive();
  }
}

export interface SealedSecret { keyVersion: string; iv: string; tag: string; wrappedDataKey: string; ciphertext: string }

function wrap(master: Buffer, dataKey: Buffer): { iv: string; tag: string; wrapped: string } {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, iv);
  const wrapped = Buffer.concat([c.update(dataKey), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), wrapped: wrapped.toString('base64') };
}
function unwrap(master: Buffer, ivB64: string, tagB64: string, wrappedB64: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', master, Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(wrappedB64, 'base64')), d.final()]);
}

/** Seal a plaintext secret with the ACTIVE master key (envelope). Returns no plaintext. */
export function seal(ring: KeyRing, plaintext: string): SealedSecret {
  const master = ring.active();
  const dataKey = randomBytes(32);
  const w = wrap(master.key, dataKey);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  // The wrapped data key's iv/tag are folded into wrappedDataKey "iv:tag:wrapped".
  return { keyVersion: master.version, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), wrappedDataKey: `${w.iv}:${w.tag}:${w.wrapped}`, ciphertext: ct.toString('base64') };
}

/** Open a sealed secret using whichever master-key VERSION sealed it (ACTIVE or PREVIOUS). */
export function open(ring: KeyRing, sealed: SealedSecret): string {
  const master = ring.get(sealed.keyVersion);
  if (!master) throw new Error(`master key version ${sealed.keyVersion} not in the keyring — cannot decrypt`);
  const [wiv, wtag, wrapped] = sealed.wrappedDataKey.split(':');
  const dataKey = unwrap(master.key, wiv!, wtag!, wrapped!);
  const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv, 'base64'));
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(sealed.ciphertext, 'base64')), d.final()]).toString('utf8');
}

/** Re-seal under the ACTIVE key (background re-encryption after rotation). */
export function reseal(ring: KeyRing, sealed: SealedSecret): SealedSecret {
  return seal(ring, open(ring, sealed));
}

/** A redaction fingerprint for audit (proves which secret without revealing it). */
export function secretFingerprint(plaintext: string, salt: string): string {
  return createHmac('sha256', salt).update(plaintext).digest('hex').slice(0, 16);
}
