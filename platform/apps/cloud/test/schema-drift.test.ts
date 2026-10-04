import { describe, expect, it } from 'vitest';
import { detectSchemaDrift, type ProviderContract } from '@/lib/markting/ops/schema-drift';

/**
 * PHASE C (C11) — schema/version drift detection. Breaking shape changes surface as a typed
 * PROVIDER_SCHEMA_CHANGED signal; additive changes are noticed but not breaking; optional-absent is
 * not drift. Pure and conservative — never mutates or repairs the payload.
 */
const contract: ProviderContract = {
  provider: 'meta',
  version: 'v19.0',
  fields: [
    { path: 'account_id', type: 'string', required: true },
    { path: 'spend', type: 'number', required: true },
    { path: 'insights.ctr', type: 'number', required: false },
    { path: 'campaigns', type: 'array', required: true },
  ],
};

describe('C11 — detectSchemaDrift', () => {
  it('a matching payload has no drift', () => {
    const r = detectSchemaDrift(contract, { account_id: 'act_1', spend: 100, insights: { ctr: 1.2 }, campaigns: [] });
    expect(r.status).toBe('NONE');
    expect(r.signal).toBeNull();
    expect(r.findings).toEqual([]);
  });

  it('a missing required field is BREAKING + raises PROVIDER_SCHEMA_CHANGED', () => {
    const r = detectSchemaDrift(contract, { account_id: 'act_1', campaigns: [] });
    expect(r.status).toBe('BREAKING');
    expect(r.signal).toBe('PROVIDER_SCHEMA_CHANGED');
    expect(r.findings.find((f) => f.path === 'spend')?.kind).toBe('MISSING_REQUIRED_FIELD');
  });

  it('a type change on a read field is BREAKING', () => {
    const r = detectSchemaDrift(contract, { account_id: 'act_1', spend: '100', campaigns: [] });
    expect(r.status).toBe('BREAKING');
    expect(r.findings.find((f) => f.path === 'spend')?.kind).toBe('TYPE_CHANGED');
    expect(r.findings.find((f) => f.path === 'spend')?.observed).toBe('string');
  });

  it('a required field present but null is BREAKING', () => {
    const r = detectSchemaDrift(contract, { account_id: null, spend: 100, campaigns: [] });
    expect(r.findings.find((f) => f.path === 'account_id')?.kind).toBe('REQUIRED_FIELD_NULL');
    expect(r.status).toBe('BREAKING');
  });

  it('an optional field absent is NOT drift', () => {
    const r = detectSchemaDrift(contract, { account_id: 'act_1', spend: 100, campaigns: [] });
    expect(r.status).toBe('NONE');
  });

  it('a brand-new unknown top-level field is ADDITIVE, not breaking', () => {
    const r = detectSchemaDrift(contract, { account_id: 'act_1', spend: 100, campaigns: [], new_field: 'x' });
    expect(r.status).toBe('ADDITIVE');
    expect(r.signal).toBe('PROVIDER_SCHEMA_CHANGED');
    expect(r.findings.find((f) => f.path === 'new_field')?.kind).toBe('NEW_UNKNOWN_FIELD');
  });

  it('breaking wins over additive when both present', () => {
    const r = detectSchemaDrift(contract, { account_id: 'act_1', campaigns: [], surprise: 1 });
    expect(r.status).toBe('BREAKING');
  });
});
