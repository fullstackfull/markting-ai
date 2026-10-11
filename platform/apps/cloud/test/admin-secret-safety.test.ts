import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redactLog } from '@/lib/markting/ops/observability';

/**
 * PHASE C.6 (27) — ADMIN SECRET-SAFETY.
 *
 * The super-admin / platform surfaces read connection + org + incident metadata through the SELECT-only
 * `adport_platform_admin` role. Credential material (OAuth access/refresh tokens, signing secrets) never
 * lives in the rows these functions touch — it is held in the `private.*` schema, which the admin role
 * cannot read at all. This suite pins that invariant against the REAL admin read source (not a copy) and
 * proves the redaction primitive the surfaces rely on strips every secret-looking field.
 */

const ADMIN_READ_SOURCES = [
  '../lib/connections/platform-read.ts',
  '../lib/connections/read.ts',
  '../lib/platform/reads.ts',
  '../lib/platform/ops-reads.ts',
  '../lib/platform/incident-reads.ts',
].map((rel) => ({ rel, path: fileURLToPath(new URL(rel, import.meta.url)) }));

/** Raw secret columns that must NEVER be selected by an admin surface. `*_ref` (an opaque pointer) is fine. */
const RAW_SECRET_COLUMN = /\b(access_token|refresh_token|client_secret|token_ciphertext|token_secret|signing_secret|encrypted_token)(?!_ref)\b/;

describe('C.6-27 — admin surfaces never read credential material', () => {
  it('every admin read source exists and is loadable', () => {
    for (const { rel, path } of ADMIN_READ_SOURCES) {
      expect(() => readFileSync(path, 'utf8'), rel).not.toThrow();
    }
  });

  it('no admin read selects a raw secret column (only *_ref pointers allowed)', () => {
    for (const { rel, path } of ADMIN_READ_SOURCES) {
      const src = readFileSync(path, 'utf8');
      const hit = src.match(RAW_SECRET_COLUMN);
      expect(hit, `${rel} references raw secret column ${hit?.[0]}`).toBeNull();
    }
  });

  it('no admin read reaches into the private.* schema where tokens live', () => {
    for (const { rel, path } of ADMIN_READ_SOURCES) {
      const src = readFileSync(path, 'utf8');
      expect(/\bprivate\.[a-z_]+/.test(src), `${rel} queries the private.* schema`).toBe(false);
    }
  });

  it('admin reads run through the SELECT-only platform-admin role, never a write pool', () => {
    // platform-read.ts is the fleet/connection surface; it must use platformDb (adport_platform_admin
    // SELECT-only), never the backend RW pool, so a compromised admin path cannot mutate or widen reads.
    const platformRead = readFileSync(
      fileURLToPath(new URL('../lib/connections/platform-read.ts', import.meta.url)),
      'utf8',
    );
    expect(platformRead).toMatch(/platformDb/);
    expect(RAW_SECRET_COLUMN.test(platformRead)).toBe(false);
  });
});

describe('C.6-27 — redaction strips every secret-looking field from an admin DTO', () => {
  it('redactLog masks token/secret/authorization/key fields at any depth', () => {
    const dto = {
      connectionId: 'c_1',
      provider: 'meta',
      status: 'connected',
      accessToken: 'EAAB-should-never-appear',
      refresh_token: 'rt-should-never-appear',
      nested: { client_secret: 'cs-should-never-appear', authorization: 'Bearer leak', apiKey: 'ak-leak' },
      list: [{ password: 'p-leak' }, { ok: 'visible' }],
    };
    const redacted = redactLog(dto);
    const serialized = JSON.stringify(redacted);

    // Non-secret metadata survives untouched.
    expect(redacted.connectionId).toBe('c_1');
    expect(redacted.provider).toBe('meta');
    expect(redacted.list[1]?.ok).toBe('visible');

    // No secret value survives anywhere in the serialized payload.
    for (const leak of ['EAAB-should-never-appear', 'rt-should-never-appear', 'cs-should-never-appear', 'Bearer leak', 'ak-leak', 'p-leak']) {
      expect(serialized, `secret value "${leak}" survived redaction`).not.toContain(leak);
    }
    expect(serialized).toContain('[REDACTED]');
  });

  it('a clean DTO is passed through unchanged (no over-redaction of metadata)', () => {
    const clean = { orgName: 'Acme', healthState: 'DEGRADED', reauthRequired: true, count: 3 };
    expect(redactLog(clean)).toEqual(clean);
  });
});
