/**
 * PHASE C.6 (item 7) — META INSIGHTS NORMALIZATION PREP (credential-free).
 *
 * A contract-first preparation for normalizing a Meta Marketing API Insights report row into the SAME
 * canonical `ReportRow` shape `lib/markting/intelligence/normalize.ts` already consumes (so the existing
 * `normalizeReportRow` can then turn it into a `MetricObservation`). Everything here is PURE and
 * synchronous: a DOCUMENTED field map, a pure `normalizeMetaInsightRow`, a `classifyRow` that fits the
 * `ProviderTransport` contract, and an EXPECTED-field `ProviderContract` for `detectSchemaDrift`.
 *
 * PROVENANCE DISCIPLINE (honest, never inflated): the field shape is DOCUMENTATION_DERIVED from the
 * published Meta Marketing API Insights reference (v19.0 — spend/impressions/clicks return as STRINGS;
 * conversions arrive inside the `actions`/`action_values` arrays keyed by `action_type`). There is NO
 * live-captured Meta response in this repo; the sample used by the tests is a FAKE payload. A real
 * Insights fetch is BLOCKED_EXTERNAL below and is never invoked here.
 *
 * HARD RULES encoded here:
 *   - NEVER infer currency or FX. `currency` is carried through only when the provider supplies it.
 *   - NEVER fabricate attribution. Only the DOCUMENTED action-attribution action_type we read
 *     (omni_purchase) is carried through; no synthetic conversion/revenue is invented.
 */
import type { ReportRow } from '@adport/core';
import type { EntityLevel } from '../intelligence/model';
import type { ExpectedField, ProviderContract } from './schema-drift';

export const META_PROVIDER_ID = 'meta';

/** Documented Meta Insights API version the field shape is grounded in. */
export const META_INSIGHTS_API_VERSION = 'v19.0';

/**
 * Meta's canonical cross-channel purchase action_type. The ONLY action-attribution we carry through —
 * documented in the Insights `actions`/`action_values` reference. We never invent other conversions.
 */
export const META_CONVERSION_ACTION_TYPE = 'omni_purchase';

/** One entry of Meta's `actions` / `action_values` array (documented shape; values are strings). */
export interface MetaActionStat {
  action_type: string;
  value: string;
}

/**
 * The DOCUMENTED raw Meta Insights row shape we parse. Numeric columns are STRINGS (as the Graph API
 * returns them). Only the fields our adapter reads are declared; unknown extras are left untouched.
 */
export interface MetaInsightRaw {
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaActionStat[];
  action_values?: MetaActionStat[];
  date_start?: string;
  date_stop?: string;
}

/**
 * DOCUMENTED field map: a Meta Insights string column -> the canonical metric key the normalized
 * `ReportRow.metrics` uses. Only the additive base metrics map directly; conversions / conversion_value
 * come from the attribution arrays (see `readAction`) and ratio metrics are DERIVED downstream, never
 * read from a provider column here.
 */
export const META_INSIGHT_FIELD_MAP = {
  spend: 'spend',
  impressions: 'impressions',
  clicks: 'clicks',
} as const satisfies Record<string, string>;

/** The EXPECTED Meta Insights fields, for `detectSchemaDrift` (base report row). The identity columns are
 *  declared too (optional — which ones appear depends on the breakdown level) so a documented row carries
 *  no un-contracted top-level key the drift detector would otherwise flag ADDITIVE. */
const META_EXPECTED_FIELDS: ExpectedField[] = [
  { path: 'date_start', type: 'string', required: true },
  { path: 'date_stop', type: 'string', required: true },
  { path: 'spend', type: 'string', required: true },
  { path: 'impressions', type: 'string', required: true },
  { path: 'clicks', type: 'string', required: false },
  // actions / action_values are optional arrays — absent when the entity had no attributed conversions.
  { path: 'actions', type: 'array', required: false },
  { path: 'action_values', type: 'array', required: false },
  // Identity columns (presence varies by level) — declared so they are not seen as unknown drift.
  { path: 'account_id', type: 'string', required: false },
  { path: 'campaign_id', type: 'string', required: false },
  { path: 'campaign_name', type: 'string', required: false },
  { path: 'adset_id', type: 'string', required: false },
  { path: 'adset_name', type: 'string', required: false },
  { path: 'ad_id', type: 'string', required: false },
  { path: 'ad_name', type: 'string', required: false },
];

/** The Meta Insights ProviderContract consumed by `detectSchemaDrift` for drift flagging. */
export const META_INSIGHTS_CONTRACT: ProviderContract = {
  provider: META_PROVIDER_ID,
  version: META_INSIGHTS_API_VERSION,
  fields: META_EXPECTED_FIELDS,
};

/** Result of a pure normalization attempt: a canonical row, or a terse REJECT reason (no secrets). */
export type MetaNormalizeResult =
  | { ok: true; row: ReportRow }
  | { ok: false; reason: string };

/** Parse a documented numeric string column; a non-finite / missing value yields undefined (not 0). */
function numField(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Read a DOCUMENTED attribution action_type from an actions/action_values array. Never fabricated. */
function readAction(stats: MetaActionStat[] | undefined, actionType: string): number | undefined {
  if (!Array.isArray(stats)) return undefined;
  const stat = stats.find((s) => s && s.action_type === actionType);
  if (!stat) return undefined;
  const n = Number(stat.value);
  return Number.isFinite(n) ? n : undefined;
}

/** Infer the canonical entity level + identity from which id fields the documented row carries. */
function resolveEntity(raw: MetaInsightRaw): { level: EntityLevel; id: string; name: string; parentId?: string; entityType?: string } | null {
  if (raw.ad_id != null) {
    return { level: 'ad', id: raw.ad_id, name: raw.ad_name ?? raw.ad_id, parentId: raw.adset_id, entityType: 'ad' };
  }
  if (raw.adset_id != null) {
    return { level: 'ad_group', id: raw.adset_id, name: raw.adset_name ?? raw.adset_id, parentId: raw.campaign_id, entityType: 'adset' };
  }
  if (raw.campaign_id != null) {
    return { level: 'campaign', id: raw.campaign_id, name: raw.campaign_name ?? raw.campaign_id, entityType: 'campaign' };
  }
  if (raw.account_id != null) {
    return { level: 'account', id: raw.account_id, name: raw.account_id, entityType: 'account' };
  }
  return null;
}

/**
 * PURE: map a DOCUMENTED Meta Insights row -> a canonical `ReportRow` (or a REJECT reason). Carries only
 * additive base metrics + the documented omni_purchase attribution; derives nothing, infers no currency
 * or FX, fabricates no attribution. `currency` is never set here — Meta Insights rows do not carry it
 * and we refuse to guess; the account currency is supplied separately by the caller.
 */
export function normalizeMetaInsightRow(raw: MetaInsightRaw): MetaNormalizeResult {
  if (raw == null || typeof raw !== 'object') return { ok: false, reason: 'row_not_object' };

  const entity = resolveEntity(raw);
  if (!entity) return { ok: false, reason: 'missing_entity_identity' };

  const spend = numField(raw.spend);
  const impressions = numField(raw.impressions);
  // A report row with neither spend nor impressions carries no usable signal — reject (quarantine).
  if (spend === undefined && impressions === undefined) return { ok: false, reason: 'no_base_metrics' };

  const metrics: ReportRow['metrics'] = {};
  if (spend !== undefined) metrics.spend = spend;
  if (impressions !== undefined) metrics.impressions = impressions;
  const clicks = numField(raw.clicks);
  if (clicks !== undefined) metrics.clicks = clicks;

  // Documented action-attribution only — never fabricated. Absent arrays => no conversion keys set.
  const conversions = readAction(raw.actions, META_CONVERSION_ACTION_TYPE);
  if (conversions !== undefined) metrics.conversions = conversions;
  const conversionValue = readAction(raw.action_values, META_CONVERSION_ACTION_TYPE);
  if (conversionValue !== undefined) metrics.conversion_value = conversionValue;

  const row: ReportRow = {
    provider: META_PROVIDER_ID,
    accountId: raw.account_id ?? '',
    // currency intentionally omitted: never inferred here (no FX, no guess).
    entity: {
      level: entity.level,
      id: entity.id,
      name: entity.name,
      parentId: entity.parentId,
      entityType: entity.entityType,
    },
    metrics,
  };
  return { ok: true, row };
}

/**
 * A `ProviderTransport.classifyRow`-shaped classifier: 'SCHEMA' when the row's SHAPE drifts from the
 * documented contract, 'REJECT' when it parses but carries no usable signal, else 'ACCEPT'. Pure.
 * Takes the drift verdict as an injected input so this module stays free of the server-only drift import
 * at runtime — the transport wires `detectSchemaDrift(META_INSIGHTS_CONTRACT, row)` in.
 */
export function classifyMetaInsightRow(
  raw: MetaInsightRaw,
  driftBreaking: boolean,
): 'ACCEPT' | 'REJECT' | 'SCHEMA' {
  if (driftBreaking) return 'SCHEMA';
  return normalizeMetaInsightRow(raw).ok ? 'ACCEPT' : 'REJECT';
}

/*
 * BLOCKED_EXTERNAL: a real Meta Insights fetch (GET /{level}/insights on graph.facebook.com) would go
 * here, behind credentials. It is NOT invoked in this phase — no token, no network, no live read. The
 * functions above operate only on a payload the caller already holds (a FAKE sample in tests).
 */
