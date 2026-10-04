/**
 * PHASE C.5 (item 8) — SYNTHETIC sample rows for the normalized breakdown contracts.
 *
 * One hand-authored sample row per BreakdownContract, shaped to satisfy that contract exactly (so
 * detectSchemaDrift returns status NONE). These are SYNTHETIC — hand-authored shapes/ids with no live
 * capture — reusing the provenance vocabulary from test/fixtures/connection-contract-provenance.ts. NONE
 * are LIVE_CAPTURED. They exist so the contract-first target shape is exercised before live credentials
 * arrive; nothing here contacts a provider.
 */
import type { FixtureProvenance } from '@/test/fixtures/connection-contract-provenance';
import {
  ALL_BREAKDOWN_CONTRACTS,
  breakdownContractKey,
  type BreakdownContract,
} from '@/lib/markting/contracts/breakdown-contracts';

export interface BreakdownSample {
  key: string; // `${provider}:${dimension}`
  /** Always 'SYNTHETIC' — hand-authored, never recorded from a live provider. */
  provenance: Extract<FixtureProvenance, 'SYNTHETIC'>;
  row: Record<string, unknown>;
}

const SYNTHETIC: Extract<FixtureProvenance, 'SYNTHETIC'> = 'SYNTHETIC';

// Each row carries ONLY the top-level keys the matching contract declares, so detectSchemaDrift sees no
// un-contracted (ADDITIVE) key and returns status NONE.
const SAMPLE_ROWS: Record<string, Record<string, unknown>> = {
  // --- Meta (Graph API returns metric values as strings) ---
  'meta:placement': {
    publisher_platform: 'facebook',
    platform_position: 'feed',
    impression_device: 'iphone',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '10432',
    spend: '84.17',
  },
  'meta:publisher_platform': {
    publisher_platform: 'instagram',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '5120',
    spend: '41.00',
  },
  'meta:impression_device': {
    impression_device: 'android_smartphone',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '3310',
    spend: '22.80',
  },
  'meta:age': {
    age: '25-34',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '7720',
    spend: '60.40',
  },
  'meta:gender': {
    gender: 'female',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '6640',
    spend: '55.25',
  },
  'meta:geography': {
    country: 'SA',
    region: 'Riyadh',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '9900',
    spend: '70.10',
  },
  'meta:reach': {
    reach: '8450',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '10432',
    spend: '84.17',
  },
  'meta:frequency': {
    frequency: '1.23',
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    impressions: '10432',
    spend: '84.17',
  },

  // --- Google (GAQL rows are nested; int64 metrics are strings, doubles are numbers) ---
  'google:keyword': {
    adGroupCriterion: { keyword: { text: 'running shoes', matchType: 'PHRASE' } },
    metrics: { impressions: '2048' },
  },
  'google:search_term': {
    searchTermView: { searchTerm: 'best running shoes 2026' },
    metrics: { impressions: '1536' },
  },
  'google:match_type': {
    adGroupCriterion: { keyword: { matchType: 'EXACT' } },
    metrics: { impressions: '990' },
  },
  'google:device': {
    segments: { device: 'MOBILE' },
    metrics: { impressions: '4096' },
  },
  'google:ad_network_type': {
    segments: { adNetworkType: 'SEARCH' },
    metrics: { impressions: '3200' },
  },
  'google:conversion_action': {
    segments: { conversionAction: 'customers/123/conversionActions/456' },
    metrics: { conversions: 12 },
  },
  'google:search_impression_share': {
    metrics: { searchImpressionShare: 0.6723 },
  },
};

/** One SYNTHETIC sample per contract, in contract order. */
export const BREAKDOWN_SAMPLES: BreakdownSample[] = ALL_BREAKDOWN_CONTRACTS.map((c) => {
  const key = breakdownContractKey(c);
  const row = SAMPLE_ROWS[key];
  if (!row) throw new Error(`missing SYNTHETIC sample row for breakdown contract ${key}`);
  return { key, provenance: SYNTHETIC, row };
});

export function sampleFor(contract: BreakdownContract): BreakdownSample {
  const key = breakdownContractKey(contract);
  const found = BREAKDOWN_SAMPLES.find((s) => s.key === key);
  if (!found) throw new Error(`no SYNTHETIC sample for ${key}`);
  return found;
}

/**
 * A deliberately-broken clone of a contract's sample: the first REQUIRED field is dropped (and if a nested
 * path, its branch pruned), so detectSchemaDrift must report MISSING_REQUIRED_FIELD → BREAKING →
 * PROVIDER_SCHEMA_CHANGED. SYNTHETIC like the valid sample; used only to prove the classifier fires.
 */
export function brokenSampleFor(contract: BreakdownContract): Record<string, unknown> {
  const firstRequired = contract.fields.find((f) => f.required);
  if (!firstRequired) throw new Error(`contract ${breakdownContractKey(contract)} has no required field to break`);
  const row = structuredClone(sampleFor(contract).row);
  deletePath(row, firstRequired.path);
  return row;
}

function deletePath(obj: Record<string, unknown>, path: string): void {
  const segs = path.split('.');
  const leaf = segs.pop();
  if (leaf === undefined) return;
  let cur: Record<string, unknown> = obj;
  for (const seg of segs) {
    const next = cur[seg];
    if (next == null || typeof next !== 'object') return; // branch absent → nothing to delete
    cur = next as Record<string, unknown>;
  }
  delete cur[leaf];
}
