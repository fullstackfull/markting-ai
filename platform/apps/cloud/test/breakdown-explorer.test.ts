import { describe, it, expect } from 'vitest';
import {
  explorerDimensionMeta,
  explorerDimensions,
  reachableExplorerDimensions,
  resolveSelectedDimension,
  buildExplorerRows,
  buildBreakdownExplorerView,
} from '@/lib/cloud/breakdown-explorer';
import type { BreakdownRow } from '@/lib/markting/intelligence/audience';
import { reachableBreakdownDimensions } from '@/lib/connections/registry';

const placementRows: BreakdownRow[] = [
  { dimension: 'placement', value: 'Feed', spend: 1800000, conversions: 420, conversion_value: 7200000, currency: 'SAR' },
  { dimension: 'placement', value: 'Stories', spend: 900000, conversions: 120, conversion_value: 1500000, currency: 'SAR' },
  { dimension: 'placement', value: 'Reels', spend: 900000, conversions: 0, currency: 'SAR' },
];
const ageRows: BreakdownRow[] = [
  { dimension: 'age', value: '18-24', spend: 800000, conversions: 120, conversion_value: 1300000, currency: 'SAR' },
  { dimension: 'age', value: '25-34', spend: 1700000, conversions: 340, conversion_value: 6000000, currency: 'SAR' },
];

describe('B11 — Breakdown Explorer gating (registry is the single source of truth)', () => {
  it('marks a RAW_ONLY dimension reachable + rawOnly, and a NOT_SUPPORTED dimension unreachable', () => {
    const placement = explorerDimensionMeta('meta', 'placement');
    expect(placement.reachable).toBe(true);
    expect(placement.rawOnly).toBe(true); // meta exposes placement only via raw export
    expect(placement.protectedDimension).toBe(false);

    const keyword = explorerDimensionMeta('meta', 'keyword');
    expect(keyword.support).toBe('NOT_SUPPORTED');
    expect(keyword.reachable).toBe(false);
  });

  it('flags protected dimensions (age/gender) from the engine vocabulary', () => {
    expect(explorerDimensionMeta('meta', 'age').protectedDimension).toBe(true);
    expect(explorerDimensionMeta('meta', 'gender').protectedDimension).toBe(true);
    expect(explorerDimensionMeta('meta', 'device').protectedDimension).toBe(false);
  });

  it('only exposes dimensions the registry reaches (matches reachableBreakdownDimensions)', () => {
    const fromExplorer = reachableExplorerDimensions('meta').map((d) => d.dimension).sort();
    const fromRegistry = [...reachableBreakdownDimensions('meta')].sort();
    expect(fromExplorer).toEqual(fromRegistry);
    // A provider with no breakdown dimensions reaches nothing.
    expect(reachableExplorerDimensions('pinterest')).toHaveLength(0);
    expect(explorerDimensions('pinterest').every((d) => !d.reachable)).toBe(true);
  });

  it('resolves the requested dimension, defaulting to the first reachable one', () => {
    expect(resolveSelectedDimension('meta', 'device')).toBe('device');
    // An unreachable but valid dimension id is returned as-is (the surface then gates on support).
    expect(resolveSelectedDimension('meta', 'keyword')).toBe('keyword');
    // No requested dimension → first reachable.
    expect(resolveSelectedDimension('meta', undefined)).toBe('placement');
  });
});

describe('B11 — per-value row computation', () => {
  it('computes CPA/ROAS/share, and never fabricates a CPA/ROAS when the denominator is 0', () => {
    const rows = buildExplorerRows(placementRows);
    const feed = rows.find((r) => r.value === 'Feed')!;
    expect(feed.cpaMinor).toBe(Math.round(1800000 / 420));
    expect(feed.roas).toBe(Math.round((7200000 / 1800000) * 100) / 100);
    expect(feed.spendSharePct).toBe(50); // 1.8M of 3.6M
    const reels = rows.find((r) => r.value === 'Reels')!;
    expect(reels.cpaMinor).toBeNull(); // 0 conversions → no CPA, never a fake 0
    expect(reels.roas).toBeNull();     // no revenue → no ROAS
  });
});

describe('B11 — explorer view state machine (honest states)', () => {
  const rawRowsFor = (dim: string) => (dim === 'placement' ? placementRows : dim === 'age' ? ageRows : []);

  it('live is always NOT_CONNECTED (no provider feeds breakdowns into the normalized path)', () => {
    const v = buildBreakdownExplorerView({ providerId: '', connected: false, requested: 'placement', rawRowsFor });
    expect(v.state).toBe('NOT_CONNECTED');
    expect(v.rows).toHaveLength(0);
  });

  it('an unsupported dimension is NOT_SUPPORTED, never shown as data', () => {
    const v = buildBreakdownExplorerView({ providerId: 'meta', connected: true, requested: 'keyword', rawRowsFor });
    expect(v.state).toBe('NOT_SUPPORTED');
    expect(v.rows).toHaveLength(0);
  });

  it('a reachable dimension with rows is OK and carries the deterministic analysis', () => {
    const v = buildBreakdownExplorerView({ providerId: 'meta', connected: true, requested: 'placement', rawRowsFor });
    expect(v.state).toBe('OK');
    expect(v.rows.length).toBe(3);
    expect(v.analysis?.concentration).toBeDefined();
    expect(v.analysis?.spendHHI).toBeGreaterThan(0);
  });

  it('a reachable dimension with no rows is NO_DATA (distinct from NOT_SUPPORTED)', () => {
    const v = buildBreakdownExplorerView({ providerId: 'meta', connected: true, requested: 'device', rawRowsFor });
    expect(v.state).toBe('NO_DATA');
  });

  it('a protected dimension is reported but NEVER actionable (the guard holds through the explorer)', () => {
    const v = buildBreakdownExplorerView({ providerId: 'meta', connected: true, requested: 'age', rawRowsFor });
    expect(v.state).toBe('OK');
    expect(v.selectedMeta?.protectedDimension).toBe(true);
    expect(v.analysis?.protectedDimension).toBe(true);
    expect(v.analysis?.actionable).toBe(false);
    expect(v.analysis?.efficiencySpread).toBeUndefined(); // no best/worst CPA cut for a protected dim
  });
});
