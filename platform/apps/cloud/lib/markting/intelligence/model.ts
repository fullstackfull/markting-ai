/**
 * Canonical marketing intelligence model (Phase 1C). Provider-specific detail is preserved, not
 * erased: canonical core entities carry the raw provider id and source, and MetricObservation keeps
 * the attribution basis, currency, timezone, freshness and data-trust that make a number comparable
 * (or not). Nothing here infers FX or merges incompatible attribution silently.
 */
import type { DataTrust, DataTier } from '../data-trust';

export type EntityLevel = 'account' | 'campaign' | 'ad_group' | 'ad';

/** Canonical metric vocabulary: the core normalized metrics plus the funnel/engagement extensions. */
export const CANONICAL_METRICS = [
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpc', 'cpm',
  'conversions', 'conversion_value', 'cpa', 'roas',
  'video_views', 'engagement', 'landing_page_views', 'add_to_cart', 'checkout', 'purchase', 'lead',
] as const;
export type CanonicalMetric = (typeof CANONICAL_METRICS)[number];

/** Ratio metrics are derived, never summed; base metrics are additive counts/money. */
export const RATIO_METRICS: ReadonlySet<CanonicalMetric> = new Set(['ctr', 'cpc', 'cpm', 'cpa', 'roas', 'frequency']);

/** Attribution basis label, e.g. a Meta "omni_purchase 7d-click/1d-view" window. Never merged across. */
export interface AttributionBasis {
  /** Human/stable label used for the compatibility gate. */
  label: string;
  /** Conversion event the value counts, when known (e.g. 'omni_purchase'). */
  event?: string;
  /** Click/view window descriptor, when known. */
  window?: string;
}

/** Canonical entity reference: the normalized concept + the preserved raw provider identity. */
export interface CanonicalEntityRef {
  level: EntityLevel;
  /** Canonical id used within markting (namespaced provider:account:raw). */
  id: string;
  /** The untouched provider-native id. */
  rawId: string;
  name: string;
  status?: string;
  sourceProvider: string;
  accountId: string;
}

/** A single normalized metric reading for one entity over one window from one provider. */
export interface MetricObservation {
  provider: string;
  accountId: string;
  entity: CanonicalEntityRef;
  dateRange: { start: string; end: string };
  /** IANA timezone the window is expressed in, when known. */
  timezone?: string;
  /** Reporting currency for monetary metrics, when known. */
  currency?: string;
  attribution?: AttributionBasis;
  /** Trust metadata travels with every observation (Phase 0 data-trust, wired here). */
  trust: DataTrust;
  metrics: Partial<Record<CanonicalMetric, number>>;
  /** Preserved original values where normalization was lossy (provider-specific extension bag). */
  raw?: Record<string, unknown>;
}

/** Thin canonical entity interfaces — IDs preserved, source preserved; extended in later phases. */
export interface Organization { id: string; name?: string }
export interface Workspace { id: string; organizationId: string; name?: string }
export interface Brand { id: string; organizationId: string; name: string }
export interface AdConnection { id: string; organizationId: string; provider: string; status?: string }
export interface AdAccount { id: string; rawId: string; provider: string; name?: string; currency?: string; timezone?: string; status?: string }
export interface Campaign extends CanonicalEntityRef { level: 'campaign' }
export interface AdGroup extends CanonicalEntityRef { level: 'ad_group'; campaignRawId?: string }
export interface Ad extends CanonicalEntityRef { level: 'ad'; adGroupRawId?: string }
export interface Creative { id: string; rawId: string; provider: string; accountId: string; name?: string; raw?: Record<string, unknown> }
export interface Audience { id: string; rawId: string; provider: string; accountId: string; name?: string; raw?: Record<string, unknown> }
export interface Placement { id: string; rawId: string; provider: string; name?: string }
export interface RevenueSignal { source: 'platform_reported' | 'merchant'; currency?: string; value: number; trust: DataTier }

export function canonicalId(provider: string, accountId: string, rawId: string): string {
  return `${provider}:${accountId}:${rawId}`;
}
