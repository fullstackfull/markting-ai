/**
 * Phase 4A — canonical creative model. Provider-specific detail is PRESERVED (raw ids + a `raw` bag),
 * never destroyed. Everything carries trust metadata so a number can be gated. Monetary fields are in
 * the reporting currency (never blended). Media type is explicit. These are the data shapes the
 * deterministic creative engines reason over; the LLM narrates them, it does not invent fields.
 */
import type { DataTrust, DataTier } from '../data-trust';

export type MediaType = 'image' | 'video' | 'carousel' | 'text' | 'other';

/** Canonical, namespaced id: provider:account:rawId — the raw id is also preserved separately. */
export function creativeId(provider: string, accountId: string, rawId: string): string {
  return `${provider}:${accountId}:${rawId}`;
}

export interface CreativeAsset {
  assetId: string;
  rawAssetId: string;
  provider: string;
  mediaType: MediaType;
  /** Reference/thumbnail URL or internal handle — never provider credentials. */
  reference?: string;
  width?: number;
  height?: number;
  /** Seconds, for video. */
  durationSec?: number;
  format?: string;
  /** Content/media hash for dedup (Phase 4M); set by the hashing layer. */
  contentHash?: string;
  raw?: Record<string, unknown>;
}

export interface CreativeText {
  headline?: string;
  primaryText?: string;
  description?: string;
  cta?: string;
  destinationUrl?: string;
  /** Normalized-text hash for dedup. */
  textHash?: string;
}

export interface CreativePerformance {
  currency?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  conversions?: number;
  cpa?: number;
  conversionValue?: number;
  roas?: number;
  frequency?: number;
  /** Daily CTR series (oldest→newest) when available, for trend/fatigue. */
  ctrSeries?: number[];
}

export interface CreativePlacement {
  placement: string;
  /** Provider-declared compatibility, when known. */
  compatible?: boolean;
}

/** A single creative under one ad, with its text + assets + performance + trust. */
export interface Creative {
  id: string;            // canonical creative id
  rawId: string;         // untouched provider id
  provider: string;
  organizationId: string;
  accountId: string;
  campaignId?: string;
  adGroupId?: string;
  adId?: string;
  mediaType: MediaType;
  status?: string;
  firstSeen?: string;
  lastSeen?: string;
  active?: boolean;
  text?: CreativeText;
  assets: CreativeAsset[];
  placements?: CreativePlacement[];
  performance: CreativePerformance;
  trust: DataTrust;
  raw?: Record<string, unknown>;
}

/** A variant relationship between creatives (same concept, different execution). */
export interface CreativeVariant {
  creativeId: string;
  variantOf?: string;
  relation: 'EXACT_DUPLICATE' | 'LIKELY_VARIANT' | 'RELATED' | 'DISTINCT';
}

export interface CreativeClusterRef {
  clusterId: string;
  /** Explainable defining features (never an opaque embedding id). */
  definingFeatures: string[];
  creativeIds: string[];
  sampleSize: number;
  trustTier: DataTier;
}

/** A detected signal about a creative (fatigue, concentration, change-point, etc.). */
export interface CreativeSignal {
  creativeId: string;
  kind: string;
  state: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence: Record<string, unknown>;
}

/** Canonical metrics usable for creative-level comparison. */
export const CREATIVE_METRICS = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversions', 'cpa', 'conversionValue', 'roas', 'frequency'] as const;
export type CreativeMetric = (typeof CREATIVE_METRICS)[number];
