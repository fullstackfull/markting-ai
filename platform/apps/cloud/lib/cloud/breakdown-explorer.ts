/**
 * PHASE B (B11) — the Breakdown Explorer gating + row model. PURE and deterministic (no React, no DB,
 * no seed import) so it is unit-testable and shared by the surface + its loader.
 *
 * The SINGLE source of truth for which dimension a provider can surface is the connection registry
 * (reportingDimensionSupport / reachableBreakdownDimensions). The analysis is the EXISTING deterministic
 * breakdown engine (analyzeBreakdown — HHI concentration + best/worst CPA efficiency + the protected-
 * dimension guard). This module only bridges the two vocabularies and computes the per-value rows.
 *
 * Honesty invariants enforced here:
 *  - A dimension the registry marks NOT_SUPPORTED/NOT_IMPLEMENTED is NEVER shown as data, even when a
 *    (synthetic) row set exists for it.
 *  - No provider feeds a breakdown into the normalized ReportRow path, so a reachable dimension is at
 *    best RAW_ONLY — the surface labels it "raw export only, not the normalized report".
 *  - Protected dimensions (age/gender) are reported for transparency but never actionable.
 */
import {
  BREAKDOWN_DIMENSIONS,
  reportingDimensionSupport,
  type BreakdownDimension,
  type DimensionSupport,
} from '@/lib/connections/registry';
import {
  analyzeBreakdown,
  PROTECTED_DIMENSIONS,
  type BreakdownAnalysis,
  type BreakdownDimension as AudienceDimension,
  type BreakdownRow,
} from '@/lib/markting/intelligence/audience';

/**
 * Map a registry breakdown dimension to the analysis-engine vocabulary. Only the dimensions the engine
 * can analyze are mapped; `network`/`keyword`/`search_term` have no engine vocabulary (they are only
 * ever NOT_SUPPORTED for the providers that list them), so they never reach the analyzer.
 */
const REGISTRY_TO_AUDIENCE: Partial<Record<BreakdownDimension, AudienceDimension>> = {
  placement: 'placement',
  device: 'device',
  geography: 'geography',
  audience: 'audience_segment',
  age: 'age',
  gender: 'gender',
};

/** The audience-engine dimension for a registry dimension (undefined when the engine cannot analyze it). */
export function audienceDimension(dimension: BreakdownDimension): AudienceDimension | undefined {
  return REGISTRY_TO_AUDIENCE[dimension];
}

/** The explicit, distinct states the surface renders (B22): never conflate "empty" with "unsupported". */
export type ExplorerState = 'OK' | 'NO_DATA' | 'NOT_SUPPORTED' | 'NOT_CONNECTED';

/** Registry-grounded metadata for ONE dimension: is it reachable, raw-only, protected? */
export interface ExplorerDimensionMeta {
  dimension: BreakdownDimension;
  support: DimensionSupport;
  /** READY or RAW_ONLY — the dimension can be surfaced in SOME form. */
  reachable: boolean;
  /** RAW_ONLY — reachable via a raw passthrough tool, NOT the normalized report. */
  rawOnly: boolean;
  protectedDimension: boolean;
}

/** One dimension-value row with the computed CPA / ROAS / spend share. */
export interface ExplorerValueRow {
  value: string;
  spendMinor: number;
  conversions: number;
  /** minor units; null when conversions are 0 (never a divide-by-zero or a fake 0). */
  cpaMinor: number | null;
  /** null when spend is 0 or no revenue is reported. */
  roas: number | null;
  spendSharePct: number;
  currency?: string;
}

/** Registry metadata for one dimension (gating only — pure over the registry). */
export function explorerDimensionMeta(providerId: string, dimension: BreakdownDimension): ExplorerDimensionMeta {
  const support = reportingDimensionSupport(providerId, dimension);
  const audience = REGISTRY_TO_AUDIENCE[dimension];
  return {
    dimension,
    support,
    reachable: support === 'READY' || support === 'RAW_ONLY',
    rawOnly: support === 'RAW_ONLY',
    protectedDimension: audience ? PROTECTED_DIMENSIONS.has(audience) : false,
  };
}

/** Registry metadata for every dimension, in the canonical order. */
export function explorerDimensions(providerId: string): ExplorerDimensionMeta[] {
  return BREAKDOWN_DIMENSIONS.map((d) => explorerDimensionMeta(providerId, d));
}

/** The reachable (selectable) subset — the ONLY dimensions offered as data. */
export function reachableExplorerDimensions(providerId: string): ExplorerDimensionMeta[] {
  return explorerDimensions(providerId).filter((d) => d.reachable);
}

/**
 * Resolve which dimension to show: the requested one when it is reachable, else the first reachable
 * dimension, else undefined (no reachable dimension for this provider). An unreachable request is NOT
 * silently redirected — it is returned so the surface can show the honest unsupported state.
 */
export function resolveSelectedDimension(providerId: string, requested?: string | null): BreakdownDimension | undefined {
  const all = explorerDimensions(providerId);
  const asDim = BREAKDOWN_DIMENSIONS.find((d) => d === requested);
  if (asDim) return asDim; // a valid dimension id (reachable or not) — the surface gates on support
  return all.find((d) => d.reachable)?.dimension ?? all[0]?.dimension;
}

/** Compute the per-value rows (CPA/ROAS/share) from a dimension's raw breakdown rows. Pure. */
export function buildExplorerRows(rows: BreakdownRow[]): ExplorerValueRow[] {
  const totalSpend = rows.reduce((a, r) => a + r.spend, 0);
  return rows.map((r) => {
    const conv = r.conversions ?? 0;
    const rev = r.conversion_value ?? 0;
    return {
      value: r.value,
      spendMinor: r.spend,
      conversions: conv,
      cpaMinor: conv > 0 ? Math.round(r.spend / conv) : null,
      roas: r.spend > 0 && rev > 0 ? Math.round((rev / r.spend) * 100) / 100 : null,
      spendSharePct: totalSpend > 0 ? Math.round((r.spend / totalSpend) * 1000) / 10 : 0,
      currency: r.currency,
    };
  });
}

export interface BreakdownExplorerView {
  providerId: string;
  /** DEMO vs live: live is always NOT_CONNECTED (no provider feeds breakdowns into the normalized path). */
  connected: boolean;
  dimensions: ExplorerDimensionMeta[];
  reachable: ExplorerDimensionMeta[];
  /** The resolved selected dimension (may be an unreachable one the user asked for). */
  selected?: BreakdownDimension;
  selectedMeta?: ExplorerDimensionMeta;
  state: ExplorerState;
  rows: ExplorerValueRow[];
  analysis?: BreakdownAnalysis;
}

/**
 * Assemble the full view for a selected dimension. `rawRowsFor` supplies the (synthetic, in DEMO) rows
 * for a given audience dimension; it returns [] when none exist. The function is pure over its inputs so
 * the gating + state machine is fully unit-testable without the seed or a DB.
 */
export function buildBreakdownExplorerView(args: {
  providerId: string;
  connected: boolean;
  requested?: string | null;
  rawRowsFor: (dimension: AudienceDimension) => BreakdownRow[];
}): BreakdownExplorerView {
  const { providerId, connected, requested, rawRowsFor } = args;
  const dimensions = explorerDimensions(providerId);
  const reachable = dimensions.filter((d) => d.reachable);
  const selected = resolveSelectedDimension(providerId, requested);
  const selectedMeta = selected ? dimensions.find((d) => d.dimension === selected) : undefined;

  if (!connected) {
    return { providerId, connected, dimensions, reachable, selected, selectedMeta, state: 'NOT_CONNECTED', rows: [] };
  }
  if (!selectedMeta || !selectedMeta.reachable) {
    // NOT_SUPPORTED: either no reachable dimension at all, or the user asked for an unsupported one.
    return { providerId, connected, dimensions, reachable, selected, selectedMeta, state: 'NOT_SUPPORTED', rows: [] };
  }
  const audience = REGISTRY_TO_AUDIENCE[selectedMeta.dimension];
  const raw = audience ? rawRowsFor(audience) : [];
  if (!raw.length) {
    return { providerId, connected, dimensions, reachable, selected, selectedMeta, state: 'NO_DATA', rows: [] };
  }
  const analysis = audience ? analyzeBreakdown(providerId, audience, raw) : undefined;
  return {
    providerId,
    connected,
    dimensions,
    reachable,
    selected,
    selectedMeta,
    state: 'OK',
    rows: buildExplorerRows(raw),
    analysis,
  };
}
