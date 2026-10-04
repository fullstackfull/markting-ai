import { describe, expect, it } from 'vitest';
import {
  ALL_BREAKDOWN_CONTRACTS,
  META_BREAKDOWN_CONTRACTS,
  GOOGLE_BREAKDOWN_CONTRACTS,
  breakdownContractKey,
  toProviderContract,
} from '@/lib/markting/contracts/breakdown-contracts';
import {
  BREAKDOWN_SAMPLES,
  sampleFor,
  brokenSampleFor,
} from '@/lib/markting/contracts/breakdown-fixtures';
import { detectSchemaDrift } from '@/lib/markting/ops/schema-drift';
import { BREAKDOWN_DIMENSIONS } from '@/lib/connections/registry';
import { reportingDimensionSupport } from '@/lib/connections/registry';

/**
 * PHASE C.5 (item 8) — NORMALIZED BREAKDOWN CONTRACTS.
 *
 * The contracts declare the target field shapes we would parse for each Meta/Google breakdown dimension,
 * so the normalizer already knows the shape when live credentials arrive. DOCUMENTATION_DERIVED contracts
 * + SYNTHETIC samples only — never LIVE_CAPTURED, and the honest live-registry status (Meta RAW_ONLY,
 * Google NOT_SUPPORTED) is asserted below, not glossed over.
 */

describe('C.5/8 — breakdown contract integrity', () => {
  it('every contract has at least one required field', () => {
    for (const c of ALL_BREAKDOWN_CONTRACTS) {
      expect(c.fields.some((f) => f.required), `${breakdownContractKey(c)} must have >=1 required field`).toBe(true);
    }
  });

  it('every contract declares a documented API version and both providers are covered', () => {
    expect(META_BREAKDOWN_CONTRACTS.length).toBeGreaterThan(0);
    expect(GOOGLE_BREAKDOWN_CONTRACTS.length).toBeGreaterThan(0);
    for (const c of ALL_BREAKDOWN_CONTRACTS) {
      expect(c.version, `${breakdownContractKey(c)} needs a version`).toMatch(/\S/);
    }
  });

  it('contract keys are unique', () => {
    const keys = ALL_BREAKDOWN_CONTRACTS.map(breakdownContractKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('C.5/8 — provenance discipline', () => {
  it('no contract is LIVE_CAPTURED — all DOCUMENTATION_DERIVED', () => {
    for (const c of ALL_BREAKDOWN_CONTRACTS) {
      expect(c.provenance).toBe('DOCUMENTATION_DERIVED');
      expect(c.provenance).not.toBe('LIVE_CAPTURED');
    }
  });

  it('no sample is LIVE_CAPTURED — all SYNTHETIC', () => {
    expect(BREAKDOWN_SAMPLES.length).toBe(ALL_BREAKDOWN_CONTRACTS.length);
    for (const s of BREAKDOWN_SAMPLES) {
      expect(s.provenance).toBe('SYNTHETIC');
      expect(s.provenance).not.toBe('LIVE_CAPTURED');
    }
  });
});

describe('C.5/8 — SYNTHETIC samples validate against their own contract (detectSchemaDrift → NONE)', () => {
  for (const c of ALL_BREAKDOWN_CONTRACTS) {
    it(`${breakdownContractKey(c)} sample has no drift`, () => {
      const report = detectSchemaDrift(toProviderContract(c), sampleFor(c).row);
      expect(report.status, JSON.stringify(report.findings)).toBe('NONE');
      expect(report.signal).toBeNull();
      expect(report.findings).toEqual([]);
    });
  }
});

describe('C.5/8 — a deliberately-broken sample triggers PROVIDER_SCHEMA_CHANGED', () => {
  for (const c of ALL_BREAKDOWN_CONTRACTS) {
    it(`${breakdownContractKey(c)} broken sample is BREAKING`, () => {
      const report = detectSchemaDrift(toProviderContract(c), brokenSampleFor(c));
      expect(report.status).toBe('BREAKING');
      expect(report.signal).toBe('PROVIDER_SCHEMA_CHANGED');
      expect(report.findings.some((f) => f.severity === 'BREAKING')).toBe(true);
    });
  }
});

describe('C.5/8 — registry alignment (map to the nearest BreakdownDimension; do not invent entries)', () => {
  it('every non-null registryDimension exists in the registry BreakdownDimension union', () => {
    for (const c of ALL_BREAKDOWN_CONTRACTS) {
      if (c.registryDimension !== null) {
        expect(BREAKDOWN_DIMENSIONS as readonly string[]).toContain(c.registryDimension);
      }
    }
  });

  it('HONEST live status: no mapped dimension is READY today (Meta RAW_ONLY / Google NOT_SUPPORTED)', () => {
    for (const c of ALL_BREAKDOWN_CONTRACTS) {
      if (c.registryDimension === null) continue;
      const support = reportingDimensionSupport(c.provider, c.registryDimension);
      // These contracts are PREPARATION — nothing is wired into the normalized path yet.
      expect(support).not.toBe('READY');
      if (c.provider === 'google') {
        expect(support).toBe('NOT_SUPPORTED');
      }
    }
  });
});
