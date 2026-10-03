/**
 * Normalize core provider `ReportRow`s into canonical `MetricObservation`s with trust/attribution
 * metadata (Phase 1C/1E/1F). Pure. Never infers FX; never fabricates attribution. The data tier is
 * supplied by the caller from the runtime (SYNTHETIC in demo/fixture, PLATFORM_REPORTED for a live
 * provider read) so a fixture value can never be mistaken for live evidence.
 */
import type { ReportRow } from '@adport/core';
import type { DataTier, DataTrust } from '../data-trust';
import { CANONICAL_METRICS, canonicalId, type AttributionBasis, type CanonicalMetric, type MetricObservation } from './model';

export interface NormalizeContext {
  /** FIXTURE/demo → 'SYNTHETIC'; a real provider read → 'PLATFORM_REPORTED' (or higher once reconciled). */
  tier: DataTier;
  dateRange: { start: string; end: string };
  /** True only when the reporting window is closed (not the partial current day). */
  windowComplete: boolean;
  timezone?: string;
  /** Per-provider attribution basis, when known. */
  attribution?: Record<string, AttributionBasis>;
  /** ISO timestamp the data was read. */
  readAt: string;
}

const CANON = new Set<string>(CANONICAL_METRICS);

/** Conversions are the natural ratio sample size for evidence gating (CPA/ROAS rest on them). */
function sampleSizeOf(metrics: Partial<Record<CanonicalMetric, number>>): number {
  return Math.round(metrics.conversions ?? 0);
}

export function normalizeReportRow(row: ReportRow, ctx: NormalizeContext): MetricObservation {
  const metrics: Partial<Record<CanonicalMetric, number>> = {};
  for (const [key, value] of Object.entries(row.metrics)) {
    if (CANON.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      metrics[key as CanonicalMetric] = value;
    }
  }
  const attribution = ctx.attribution?.[row.provider];
  const trust: DataTrust = {
    tier: ctx.tier,
    source: ctx.tier === 'SYNTHETIC' ? 'sandbox-fixture' : `${row.provider}-report`,
    freshnessAt: ctx.readAt,
    currency: row.currency,
    timezone: ctx.timezone,
    attributionBasis: attribution?.label,
    dateRange: ctx.dateRange,
    sampleSize: sampleSizeOf(metrics),
    complete: ctx.windowComplete,
    validated: ctx.tier === 'VALIDATED' || ctx.tier === 'RECONCILED',
  };
  return {
    provider: row.provider,
    accountId: row.accountId,
    entity: {
      level: row.entity.level,
      id: canonicalId(row.provider, row.accountId, row.entity.id),
      rawId: row.entity.id,
      name: row.entity.name,
      status: row.entity.status,
      sourceProvider: row.provider,
      accountId: row.accountId,
    },
    dateRange: ctx.dateRange,
    timezone: ctx.timezone,
    currency: row.currency,
    attribution,
    trust,
    metrics,
  };
}

export function normalizeReportRows(rows: ReportRow[], ctx: NormalizeContext): MetricObservation[] {
  return rows.map((row) => normalizeReportRow(row, ctx));
}
