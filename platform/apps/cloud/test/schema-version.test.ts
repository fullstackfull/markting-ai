import { describe, expect, it } from 'vitest';
import {
  providerSchemaMetadata,
  allProviderSchemaMetadata,
  checkCompatibility,
  type ProviderSchemaMetadata,
} from '@/lib/markting/ops/schema-version';

/**
 * PHASE C.6 (item 6) — schema versioning. The compatibility matrix (COMPATIBLE / MINOR_DRIFT / BREAKING)
 * and the honest-provenance invariant: no registered metadata ever claims LIVE_CAPTURED, and meta/google
 * are DOCUMENTATION_DERIVED with a null lastVerifiedDate.
 */

const base: ProviderSchemaMetadata = {
  provider: 'meta',
  apiVersion: 'v19.0',
  adapterVersion: '1.0.0',
  capabilityVersion: '1.0.0',
  normalizedSchemaVersion: '1.0.0',
  lastVerifiedDate: null,
  fixtureProvenance: 'DOCUMENTATION_DERIVED',
};

describe('checkCompatibility — matrix', () => {
  it('COMPATIBLE — identical coordinates', () => {
    const r = checkCompatibility(base, { ...base });
    expect(r.status).toBe('COMPATIBLE');
    expect(r.reasons).toEqual([]);
  });

  it('MINOR_DRIFT — only the provider apiVersion differs', () => {
    const r = checkCompatibility(base, { ...base, apiVersion: 'v20.0' });
    expect(r.status).toBe('MINOR_DRIFT');
    expect(r.reasons.join(' ')).toContain('apiVersion');
  });

  it('BREAKING — our adapter version moved', () => {
    expect(checkCompatibility(base, { ...base, adapterVersion: '2.0.0' }).status).toBe('BREAKING');
  });

  it('BREAKING — our capability version moved', () => {
    expect(checkCompatibility(base, { ...base, capabilityVersion: '1.1.0' }).status).toBe('BREAKING');
  });

  it('BREAKING — our normalized schema version moved', () => {
    expect(checkCompatibility(base, { ...base, normalizedSchemaVersion: '2.0.0' }).status).toBe('BREAKING');
  });

  it('BREAKING outranks a simultaneous apiVersion change, and reasons list both', () => {
    const r = checkCompatibility(base, { ...base, apiVersion: 'v20.0', normalizedSchemaVersion: '2.0.0' });
    expect(r.status).toBe('BREAKING');
    expect(r.reasons.length).toBe(2);
  });
});

describe('registry — honest provenance (NEVER live)', () => {
  it('meta and google are registered, DOCUMENTATION_DERIVED, lastVerifiedDate null', () => {
    for (const id of ['meta', 'google']) {
      const m = providerSchemaMetadata(id);
      expect(m, id).toBeDefined();
      expect(m!.fixtureProvenance).toBe('DOCUMENTATION_DERIVED');
      expect(m!.lastVerifiedDate).toBeNull();
    }
  });

  it('NO registered metadata ever claims LIVE_CAPTURED', () => {
    for (const m of allProviderSchemaMetadata()) {
      expect(m.fixtureProvenance, m.provider).not.toBe('LIVE_CAPTURED');
      // a null lastVerifiedDate is the honest state until a real live capture exists
      expect(m.lastVerifiedDate, m.provider).toBeNull();
    }
  });

  it('reads return copies — the registry cannot be mutated through them', () => {
    const m = providerSchemaMetadata('meta')!;
    m.fixtureProvenance = 'LIVE_CAPTURED';
    expect(providerSchemaMetadata('meta')!.fixtureProvenance).toBe('DOCUMENTATION_DERIVED');
  });

  it('unknown provider → undefined', () => {
    expect(providerSchemaMetadata('nope')).toBeUndefined();
  });
});
