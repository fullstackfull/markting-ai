/**
 * PHASE C.6 (item 8) — GOOGLE ADS NORMALIZATION PREP (credential-free).
 *
 * The Google-side mirror of meta-normalization-prep: a contract-first, PURE preparation for normalizing a
 * Google Ads GAQL search report row into the SAME canonical `ReportRow` shape that
 * `lib/markting/intelligence/normalize.ts` consumes. A DOCUMENTED GAQL field map, a pure
 * `normalizeGoogleSearchRow`, a `ProviderTransport`-shaped classifier, and an EXPECTED-field
 * `ProviderContract` for `detectSchemaDrift`.
 *
 * PROVENANCE DISCIPLINE: the shape is DOCUMENTATION_DERIVED from the Google Ads API GAQL reference
 * (v17). GAQL returns nested camelCase JSON; int64 metrics (impressions/clicks/cost_micros) arrive as
 * STRINGS and doubles (conversions / conversions_value) as NUMBERS. There is NO live Google response in
 * this repo; the tests use a FAKE sample. A real GAQL search is BLOCKED_EXTERNAL below, never invoked.
 *
 * HARD RULES:
 *   - cost_micros is DOCUMENTED to be in micros of the account currency; we convert micros -> currency
 *     units (÷ 1e6). This is a UNIT conversion within ONE currency, not an FX conversion.
 *   - NEVER infer FX between currencies. `currency` is carried through only when the row supplies it
 *     (customer.currencyCode); otherwise it is left unset — never guessed.
 */
import type { ReportRow } from '@adport/core';
import type { EntityLevel } from '../intelligence/model';
import type { ExpectedField, ProviderContract } from './schema-drift';

export const GOOGLE_PROVIDER_ID = 'google';

/** Documented Google Ads API version the field shape is grounded in. */
export const GOOGLE_ADS_API_VERSION = 'v17';

/** DOCUMENTED: Google Ads reports cost in micros (1,000,000 micros = one currency unit). */
export const MICROS_PER_UNIT = 1_000_000;

/** One nested GAQL result row (documented camelCase JSON; only the fields we read are declared). */
export interface GoogleSearchRaw {
  customer?: { id?: string; currencyCode?: string };
  campaign?: { id?: string; name?: string; status?: string };
  adGroup?: { id?: string; name?: string; status?: string };
  adGroupAd?: { ad?: { id?: string; name?: string }; status?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number;
    conversionsValue?: number;
  };
  segments?: { date?: string };
}

/**
 * DOCUMENTED field map: a GAQL metric field (as GAQL names it) -> the canonical metric key. cost_micros
 * is special-cased (micros -> units) in `normalizeGoogleSearchRow`; the rest map value-for-value. Ratio
 * metrics are DERIVED downstream, never read from a provider column here.
 */
export const GOOGLE_FIELD_MAP = {
  'metrics.cost_micros': 'spend',
  'metrics.impressions': 'impressions',
  'metrics.clicks': 'clicks',
  'metrics.conversions': 'conversions',
  'metrics.conversions_value': 'conversion_value',
} as const satisfies Record<string, string>;

/** The EXPECTED Google GAQL fields, for `detectSchemaDrift` (campaign-level search report row). The
 *  resource objects (customer/campaign) are declared so a documented nested row carries no un-contracted
 *  top-level key the drift detector would otherwise flag ADDITIVE. */
const GOOGLE_EXPECTED_FIELDS: ExpectedField[] = [
  { path: 'segments.date', type: 'string', required: true },
  { path: 'metrics.costMicros', type: 'string', required: true },
  { path: 'metrics.impressions', type: 'string', required: true },
  { path: 'metrics.clicks', type: 'string', required: false },
  // doubles arrive as numbers; optional because a row may have no conversions.
  { path: 'metrics.conversions', type: 'number', required: false },
  { path: 'metrics.conversionsValue', type: 'number', required: false },
  // Resource objects (which appear depends on the report level) — declared so they are not unknown drift.
  { path: 'customer.id', type: 'string', required: true },
  { path: 'customer.currencyCode', type: 'string', required: false },
  { path: 'campaign.id', type: 'string', required: false },
  { path: 'campaign.name', type: 'string', required: false },
];

/** The Google GAQL ProviderContract consumed by `detectSchemaDrift`. */
export const GOOGLE_SEARCH_CONTRACT: ProviderContract = {
  provider: GOOGLE_PROVIDER_ID,
  version: GOOGLE_ADS_API_VERSION,
  fields: GOOGLE_EXPECTED_FIELDS,
};

export type GoogleNormalizeResult =
  | { ok: true; row: ReportRow }
  | { ok: false; reason: string };

/** GAQL int64 metrics are returned as strings; parse to a finite number or undefined. */
function intStr(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** GAQL double metrics are returned as numbers; pass through only finite values. */
function dbl(raw: number | undefined): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/** Infer canonical entity level + identity from which documented GAQL resource fields are present. */
function resolveEntity(raw: GoogleSearchRaw): { level: EntityLevel; id: string; name: string; status?: string; parentId?: string; entityType?: string } | null {
  if (raw.adGroupAd?.ad?.id != null) {
    return { level: 'ad', id: raw.adGroupAd.ad.id, name: raw.adGroupAd.ad.name ?? raw.adGroupAd.ad.id, status: raw.adGroupAd.status, parentId: raw.adGroup?.id, entityType: 'ad_group_ad' };
  }
  if (raw.adGroup?.id != null) {
    return { level: 'ad_group', id: raw.adGroup.id, name: raw.adGroup.name ?? raw.adGroup.id, status: raw.adGroup.status, parentId: raw.campaign?.id, entityType: 'ad_group' };
  }
  if (raw.campaign?.id != null) {
    return { level: 'campaign', id: raw.campaign.id, name: raw.campaign.name ?? raw.campaign.id, status: raw.campaign.status, entityType: 'campaign' };
  }
  if (raw.customer?.id != null) {
    return { level: 'account', id: raw.customer.id, name: raw.customer.id, entityType: 'customer' };
  }
  return null;
}

/**
 * PURE: map a DOCUMENTED Google GAQL search row -> a canonical `ReportRow` (or a REJECT reason). Converts
 * cost_micros -> currency units (same-currency unit conversion, NOT FX). Carries `currency` only from the
 * documented customer.currencyCode; never guesses or converts across currencies.
 */
export function normalizeGoogleSearchRow(raw: GoogleSearchRaw): GoogleNormalizeResult {
  if (raw == null || typeof raw !== 'object') return { ok: false, reason: 'row_not_object' };

  const entity = resolveEntity(raw);
  if (!entity) return { ok: false, reason: 'missing_entity_identity' };

  const m = raw.metrics ?? {};
  const costMicros = intStr(m.costMicros);
  const impressions = intStr(m.impressions);
  if (costMicros === undefined && impressions === undefined) return { ok: false, reason: 'no_base_metrics' };

  const metrics: ReportRow['metrics'] = {};
  // DOCUMENTED micros -> currency units; one currency, no FX.
  if (costMicros !== undefined) metrics.spend = costMicros / MICROS_PER_UNIT;
  if (impressions !== undefined) metrics.impressions = impressions;
  const clicks = intStr(m.clicks);
  if (clicks !== undefined) metrics.clicks = clicks;
  const conversions = dbl(m.conversions);
  if (conversions !== undefined) metrics.conversions = conversions;
  const conversionValue = dbl(m.conversionsValue);
  if (conversionValue !== undefined) metrics.conversion_value = conversionValue;

  // Carry currency ONLY when the row documents it. Never inferred.
  const currency = raw.customer?.currencyCode;

  const row: ReportRow = {
    provider: GOOGLE_PROVIDER_ID,
    accountId: raw.customer?.id ?? '',
    ...(currency ? { currency } : {}),
    entity: {
      level: entity.level,
      id: entity.id,
      name: entity.name,
      status: entity.status,
      parentId: entity.parentId,
      entityType: entity.entityType,
    },
    metrics,
  };
  return { ok: true, row };
}

/**
 * A `ProviderTransport.classifyRow`-shaped classifier: 'SCHEMA' on a drifting shape, 'REJECT' on a row
 * that parses but has no usable signal, else 'ACCEPT'. The drift verdict is injected (see Meta prep).
 */
export function classifyGoogleSearchRow(
  raw: GoogleSearchRaw,
  driftBreaking: boolean,
): 'ACCEPT' | 'REJECT' | 'SCHEMA' {
  if (driftBreaking) return 'SCHEMA';
  return normalizeGoogleSearchRow(raw).ok ? 'ACCEPT' : 'REJECT';
}

/*
 * BLOCKED_EXTERNAL: a real GAQL search (POST googleads.googleapis.com/v17/customers/{id}/googleAds:search)
 * would go here, behind credentials + a developer token. It is NOT invoked in this phase — no token, no
 * network, no live read. The functions above operate only on a payload the caller already holds (a FAKE
 * sample in tests).
 */
