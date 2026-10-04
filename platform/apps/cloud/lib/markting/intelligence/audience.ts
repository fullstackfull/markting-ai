/**
 * Phase 2M — audience / placement breakdown intelligence. Only dimensions a provider actually exposes
 * are analyzed; unsupported dimensions are marked, never fabricated. It finds concentration and
 * material efficiency differences across breakdown values. It deliberately does NOT emit
 * recommendations that target protected characteristics (age/gender/ethnicity/etc.) — those dimensions
 * may be reported for transparency but never turned into a "exclude group X" suggestion.
 */
import type { BiText } from './decision-model';
import { reportingDimensionSupport, type BreakdownDimension as RegistryDimension } from '@/lib/connections/registry';

export const BREAKDOWN_DIMENSIONS = ['placement', 'device', 'geography', 'audience_segment', 'age', 'gender'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

/** Dimensions that reflect protected characteristics — reported, never used for a targeting cut. */
export const PROTECTED_DIMENSIONS: ReadonlySet<BreakdownDimension> = new Set(['age', 'gender']);

export interface BreakdownRow {
  dimension: BreakdownDimension;
  value: string;
  spend: number;
  conversions?: number;
  conversion_value?: number;
  currency?: string;
}

export interface BreakdownAnalysis {
  dimension: BreakdownDimension;
  supported: boolean;
  protectedDimension: boolean;
  spendHHI?: number;
  concentration?: 'DIVERSE' | 'MODERATE' | 'CONCENTRATED';
  /** Best/worst by CPA when conversions allow — omitted for protected dimensions. */
  efficiencySpread?: { best: { value: string; cpa: number }; worst: { value: string; cpa: number } };
  actionable: boolean;
  notes: BiText[];
}

/**
 * PHASE C0.2 — the analysis-engine dimension vocabulary bridged to the ONE canonical capability
 * registry. The engine's `audience_segment` is the registry's `audience`; every other dimension is
 * named identically. There is NO separate per-provider support map here any more: whether a breakdown
 * dimension is analyzable for a provider is derived from `reportingDimensionSupport` in
 * lib/connections/registry.ts (the single source of truth), so the seed analysis, the Breakdown
 * Explorer, and the UI gating can never diverge.
 */
const ENGINE_TO_REGISTRY: Record<BreakdownDimension, RegistryDimension> = {
  placement: 'placement',
  device: 'device',
  geography: 'geography',
  audience_segment: 'audience',
  age: 'age',
  gender: 'gender',
};

/**
 * Whether `analyzeBreakdown` may run for a (provider, dimension) pair — projected from the registry.
 * A dimension is analyzable iff the registry marks it reachable in SOME form (READY = normalized rows,
 * or RAW_ONLY = raw passthrough). NOT_SUPPORTED/NOT_IMPLEMENTED → false. No invented map; no divergence.
 */
export function supportsBreakdown(provider: string, dimension: BreakdownDimension): boolean {
  const support = reportingDimensionSupport(provider, ENGINE_TO_REGISTRY[dimension]);
  return support === 'READY' || support === 'RAW_ONLY';
}

export function analyzeBreakdown(provider: string, dimension: BreakdownDimension, rows: BreakdownRow[]): BreakdownAnalysis {
  const supported = supportsBreakdown(provider, dimension);
  const isProtected = PROTECTED_DIMENSIONS.has(dimension);
  const notes: BiText[] = [];
  if (!supported) {
    notes.push({ en: `${provider} does not expose the ${dimension} breakdown.`, ar: `${provider} لا يوفّر تصنيف ${dimension}.` });
    return { dimension, supported: false, protectedDimension: isProtected, actionable: false, notes };
  }
  const currencies = new Set(rows.map((r) => r.currency).filter(Boolean));
  const mixed = currencies.size > 1;
  const totalSpend = rows.reduce((a, r) => a + r.spend, 0);
  const shares = rows.map((r) => (totalSpend > 0 ? r.spend / totalSpend : 0));
  const spendHHI = Math.round(shares.reduce((a, s) => a + s * s, 0) * 1000) / 1000;
  const concentration = spendHHI >= 0.5 ? 'CONCENTRATED' : spendHHI >= 0.25 ? 'MODERATE' : 'DIVERSE';

  let efficiencySpread: BreakdownAnalysis['efficiencySpread'];
  if (!isProtected && !mixed) {
    const withCpa = rows.filter((r) => (r.conversions ?? 0) > 0).map((r) => ({ value: r.value, cpa: r.spend / (r.conversions ?? 1) }));
    if (withCpa.length >= 2) {
      const sorted = [...withCpa].sort((a, b) => a.cpa - b.cpa);
      efficiencySpread = { best: sorted[0]!, worst: sorted[sorted.length - 1]! };
    }
  }
  if (isProtected) notes.push({ en: `${dimension} is a protected characteristic — reported for transparency only, never used to recommend exclusions.`, ar: `${dimension} خاصية محمية — تُعرض للشفافية فقط ولا تُستخدم للتوصية باستبعاد أي فئة.` });
  if (mixed) notes.push({ en: 'Breakdown rows span multiple currencies — efficiency not compared.', ar: 'صفوف التصنيف تشمل عملات متعددة — لم تُقارَن الكفاءة.' });

  const actionable = supported && !isProtected && !mixed && !!efficiencySpread;
  return { dimension, supported, protectedDimension: isProtected, spendHHI, concentration, efficiencySpread, actionable, notes };
}
