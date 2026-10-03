/**
 * Phase 7S — enterprise SERVICE ACCOUNTS / API keys. Scopes, expiration, rotation, revocation, audit,
 * last-used tracking. A service account can NEVER satisfy a human approval requirement (enforced in
 * rbac.canApprove) and holding `manage_billing` never implies ad-write. Keys fail closed: expired,
 * revoked, or out-of-scope → denied.
 */
import { createHash, randomBytes } from 'node:crypto';

export const SERVICE_SCOPES = ['tools:read', 'tools:write', 'reports:read', 'ops:execute'] as const;
export type ServiceScope = (typeof SERVICE_SCOPES)[number];

export interface ServiceAccount {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  scopes: ServiceScope[];
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  isServiceAccount: true;
}

/** Mint a key: returns the plaintext (shown ONCE) + the stored hash + prefix. Secret never stored raw. */
export function mintServiceKey(): { plaintext: string; secretHash: string; keyPrefix: string } {
  const raw = randomBytes(24).toString('base64url');
  const prefix = `mk_${raw.slice(0, 6)}`;
  const plaintext = `${prefix}.${raw}`;
  return { plaintext, secretHash: createHash('sha256').update(plaintext).digest('hex'), keyPrefix: prefix };
}

export type KeyAuthResult = { ok: true; account: ServiceAccount } | { ok: false; reason: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'OUT_OF_SCOPE' };

/** Authenticate a presented key against a stored account and a required scope. Fails closed. */
export function authenticateServiceKey(input: {
  presented: string; account: ServiceAccount | null; storedHash: string | null; requiredScope: ServiceScope; now?: number;
}): KeyAuthResult {
  const now = input.now ?? Date.now();
  if (!input.account || !input.storedHash) return { ok: false, reason: 'NOT_FOUND' };
  if (createHash('sha256').update(input.presented).digest('hex') !== input.storedHash) return { ok: false, reason: 'NOT_FOUND' };
  if (input.account.revokedAt) return { ok: false, reason: 'REVOKED' };
  if (input.account.expiresAt && now > Date.parse(input.account.expiresAt)) return { ok: false, reason: 'EXPIRED' };
  if (!input.account.scopes.includes(input.requiredScope)) return { ok: false, reason: 'OUT_OF_SCOPE' };
  return { ok: true, account: input.account };
}

/** Rotation: mint a fresh key for the same account; the old hash is revoked by the store. */
export function rotateServiceKey(): ReturnType<typeof mintServiceKey> { return mintServiceKey(); }
