/**
 * PHASE C.5 (item 8) — NORMALIZED BREAKDOWN CONTRACTS.
 *
 * The expected RESPONSE FIELD SHAPES we would parse when normalizing a breakdown report row for each
 * breakdown dimension. These contracts declare the TARGET SHAPE up front so that when live credentials
 * eventually arrive, the normalizer already knows what fields (dotted paths + types + required-ness) it
 * must read — a contract-first preparation step, validated here against SYNTHETIC samples with the same
 * drift classifier the live adapter will use (`detectSchemaDrift`).
 *
 * PROVENANCE DISCIPLINE: every contract here is DOCUMENTATION_DERIVED (constructed from the provider's
 * published API docs — Meta Marketing API Insights breakdowns, Google Ads API GAQL segments/metrics) and
 * every sample row is SYNTHETIC. NOTHING in this module is LIVE_CAPTURED — no live provider response has
 * been recorded (see test/fixtures/connection-contract-provenance.ts; there are no live cassettes in this
 * repo). These shapes are a PREPARATION for live normalization, not a claim that the path is wired.
 *
 * HONEST LIVE STATUS (lib/connections/registry.ts is the single source of truth):
 *   - Meta placement/device/geography/age/gender are RAW_ONLY today — reachable only via a raw passthrough
 *     tool, NOT fed into the normalized ReportRow path. (publisher_platform / impression_device have no
 *     registry entry of their own; they map to the nearest registry dimension — see `registryDimension`.)
 *   - Google keyword/search_term/match_type/device/network/conversion_action/impression_share are all
 *     NOT_SUPPORTED today — there is NO normalized path wired for ANY Google breakdown. These contracts
 *     are PREPARATION for when they are, not a claim they are live.
 * No provider is READY for any breakdown dimension in the registry today.
 */
import type { ExpectedField, ProviderContract } from '@/lib/markting/ops/schema-drift';
import type { BreakdownDimension } from '@/lib/connections/registry';

/**
 * A normalization contract for one provider breakdown dimension: the provider-native breakdown name, the
 * documented API version the shape is drawn from, the fields we expect to parse, and the provenance of how
 * the shape was derived (always DOCUMENTATION_DERIVED here — never LIVE_CAPTURED).
 */
export interface BreakdownContract {
  provider: 'meta' | 'google';
  /** Provider-native breakdown / segment name as it appears in the provider's API & docs. */
  dimension: string;
  /**
   * The nearest registry BreakdownDimension this contract maps onto, or null when the provider concept has
   * NO registry dimension of its own (a metric like reach/frequency/impression_share, or a facet such as
   * conversion_action). We map to an existing union member — we never invent a registry entry here.
   */
  registryDimension: BreakdownDimension | null;
  /** A documented provider API version string the shape is grounded in. */
  version: string;
  fields: ExpectedField[];
  /** Constructed from published API docs. Never 'LIVE_CAPTURED'. */
  provenance: 'DOCUMENTATION_DERIVED';
}

/** Adapt a BreakdownContract to the ProviderContract shape `detectSchemaDrift` consumes. */
export function toProviderContract(c: BreakdownContract): ProviderContract {
  return { provider: c.provider, version: c.version, fields: c.fields };
}

// Common Meta Insights envelope metrics (values are returned as STRINGS by the Graph API). Each contract
// declares the breakdown-specific field(s) plus these, so a SYNTHETIC sample carries no un-contracted
// top-level key (which detectSchemaDrift would otherwise flag ADDITIVE).
const META_COMMON: ExpectedField[] = [
  { path: 'date_start', type: 'string', required: true },
  { path: 'date_stop', type: 'string', required: true },
  { path: 'impressions', type: 'string', required: true },
  { path: 'spend', type: 'string', required: false },
];

/**
 * META ADS — Marketing API Insights breakdowns (v19.0). Breakdown keys arrive as extra string columns on
 * each insights row. registryDimension maps each to lib/connections/registry's BreakdownDimension union:
 *   placement          -> 'placement'
 *   publisher_platform -> 'placement'  (a facet of placement; no own registry dimension)
 *   impression_device  -> 'device'
 *   age                -> 'age'
 *   gender             -> 'gender'
 *   country/region     -> 'geography'
 *   reach / frequency  -> null         (metrics, not registry breakdown dimensions)
 */
export const META_BREAKDOWN_CONTRACTS: BreakdownContract[] = [
  {
    provider: 'meta',
    dimension: 'placement',
    registryDimension: 'placement',
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    // Meta returns placement as the pair publisher_platform + platform_position; impression_device often
    // accompanies a placement breakdown.
    fields: [
      { path: 'publisher_platform', type: 'string', required: true },
      { path: 'platform_position', type: 'string', required: true },
      { path: 'impression_device', type: 'string', required: false },
      ...META_COMMON,
    ],
  },
  {
    provider: 'meta',
    dimension: 'publisher_platform',
    registryDimension: 'placement',
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [{ path: 'publisher_platform', type: 'string', required: true }, ...META_COMMON],
  },
  {
    provider: 'meta',
    dimension: 'impression_device',
    registryDimension: 'device',
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [{ path: 'impression_device', type: 'string', required: true }, ...META_COMMON],
  },
  {
    provider: 'meta',
    dimension: 'age',
    registryDimension: 'age',
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [{ path: 'age', type: 'string', required: true }, ...META_COMMON],
  },
  {
    provider: 'meta',
    dimension: 'gender',
    registryDimension: 'gender',
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [{ path: 'gender', type: 'string', required: true }, ...META_COMMON],
  },
  {
    provider: 'meta',
    dimension: 'geography',
    registryDimension: 'geography',
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    // country is required when breaking down by country; region is the optional sub-level.
    fields: [
      { path: 'country', type: 'string', required: true },
      { path: 'region', type: 'string', required: false },
      ...META_COMMON,
    ],
  },
  {
    provider: 'meta',
    dimension: 'reach',
    registryDimension: null, // metric, not a registry breakdown dimension
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [{ path: 'reach', type: 'string', required: true }, ...META_COMMON],
  },
  {
    provider: 'meta',
    dimension: 'frequency',
    registryDimension: null, // metric, not a registry breakdown dimension
    version: 'v19.0',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [{ path: 'frequency', type: 'string', required: true }, ...META_COMMON],
  },
];

/**
 * GOOGLE ADS — GAQL segments/metrics (API v17). Rows are nested objects; values are camelCase JSON. int64
 * metrics arrive as STRINGS and double metrics (ratios like search_impression_share) as NUMBERS.
 *
 * HONEST: EVERY Google breakdown below is NOT_SUPPORTED in the live registry today — no normalized path is
 * wired for any of them. These are contracts PREPARING the target shape, not live claims.
 *
 * registryDimension maps each Google segment to the registry's BreakdownDimension union:
 *   keyword            -> 'keyword'
 *   search_term        -> 'search_term'
 *   match_type         -> 'keyword'     (a facet of the keyword; no own registry dimension)
 *   device             -> 'device'
 *   ad_network_type    -> 'network'
 *   conversion_action  -> null          (a conversion facet; no registry dimension)
 *   search_impression_share -> null     (a metric, not a registry breakdown dimension)
 */
export const GOOGLE_BREAKDOWN_CONTRACTS: BreakdownContract[] = [
  {
    provider: 'google',
    dimension: 'keyword',
    registryDimension: 'keyword',
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [
      { path: 'adGroupCriterion.keyword.text', type: 'string', required: true },
      { path: 'adGroupCriterion.keyword.matchType', type: 'string', required: false },
      { path: 'metrics.impressions', type: 'string', required: true },
    ],
  },
  {
    provider: 'google',
    dimension: 'search_term',
    registryDimension: 'search_term',
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [
      { path: 'searchTermView.searchTerm', type: 'string', required: true },
      { path: 'metrics.impressions', type: 'string', required: true },
    ],
  },
  {
    provider: 'google',
    dimension: 'match_type',
    registryDimension: 'keyword', // match_type is a facet of the keyword; no own registry dimension
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [
      { path: 'adGroupCriterion.keyword.matchType', type: 'string', required: true },
      { path: 'metrics.impressions', type: 'string', required: true },
    ],
  },
  {
    provider: 'google',
    dimension: 'device',
    registryDimension: 'device',
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [
      { path: 'segments.device', type: 'string', required: true },
      { path: 'metrics.impressions', type: 'string', required: true },
    ],
  },
  {
    provider: 'google',
    dimension: 'ad_network_type',
    registryDimension: 'network',
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [
      { path: 'segments.adNetworkType', type: 'string', required: true },
      { path: 'metrics.impressions', type: 'string', required: true },
    ],
  },
  {
    provider: 'google',
    dimension: 'conversion_action',
    registryDimension: null, // conversion facet; no registry breakdown dimension
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    fields: [
      { path: 'segments.conversionAction', type: 'string', required: true },
      { path: 'metrics.conversions', type: 'number', required: false },
    ],
  },
  {
    provider: 'google',
    dimension: 'search_impression_share',
    registryDimension: null, // ratio metric, not a registry breakdown dimension
    version: 'v17',
    provenance: 'DOCUMENTATION_DERIVED',
    // search_impression_share is a double → number (unlike int64 metrics, which GAQL returns as strings).
    fields: [{ path: 'metrics.searchImpressionShare', type: 'number', required: true }],
  },
];

/** All breakdown contracts (Meta + Google), keyed by `${provider}:${dimension}`. */
export const ALL_BREAKDOWN_CONTRACTS: BreakdownContract[] = [
  ...META_BREAKDOWN_CONTRACTS,
  ...GOOGLE_BREAKDOWN_CONTRACTS,
];

export function breakdownContractKey(c: BreakdownContract): string {
  return `${c.provider}:${c.dimension}`;
}
