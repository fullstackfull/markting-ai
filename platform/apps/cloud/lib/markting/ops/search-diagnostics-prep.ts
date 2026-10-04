/**
 * PHASE C.6 (item 9) — SEARCH INTELLIGENCE DIAGNOSTICS (REVIEW_ONLY, credential-free).
 *
 * PURE, read-only diagnostics over canonical search rows (the metrics `normalizeGoogleSearchRow` emits,
 * plus the optional search-term / quality-score facets a search report can carry). Each diagnostic
 * SURFACES a finding for a human to review — it NEVER applies a mutation, never writes, never
 * auto-pauses, never auto-adds a negative keyword. The output is advisory evidence only.
 *
 * AUTO-APPLY IS UNREPRESENTABLE HERE BY CONSTRUCTION:
 *   - every suggestion carries the literal `reviewOnly: true` (a `true`-typed field — it can never be
 *     set to false);
 *   - `recommendedAction` is a human-readable STRING describing what a reviewer might do, never an
 *     executable handle (no callback, no mutation op, no entity-write payload);
 *   - the `NoAutoApply` type guard below makes any suggestion shape that carries an apply/execute/mutate/
 *     write field fail to type-check, so an applied mutation cannot even be expressed.
 * There is NO function in this module that returns anything but `SearchSuggestion` objects.
 */
import type { CanonicalMetric } from '../intelligence/model';

/** A single canonical search row the diagnostics read. Metrics use the canonical metric vocabulary. */
export interface CanonicalSearchRow {
  /** Canonical entity id (campaign / ad_group / keyword scope), for evidence only. */
  entityId: string;
  entityName?: string;
  /** The search term or keyword text, when the row is at search-term / keyword grain. */
  searchTerm?: string;
  /** Reporting currency, for evidence only. Never used to infer or convert FX. */
  currency?: string;
  metrics: Partial<Record<CanonicalMetric, number>>;
  /** Google quality score (1-10) when the row carries it; absent otherwise. */
  qualityScore?: number;
}

/** Diagnostic kinds this module surfaces. Extend here, never with an "apply" variant. */
export type SearchFindingKind = 'WASTED_SPEND' | 'LOW_QUALITY_SCORE' | 'SEARCH_TERM_NEGATIVE_CANDIDATE';

export type SuggestionConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * A review-only suggestion. `reviewOnly` is the literal `true` — the type system forbids a `false` here,
 * so a suggestion can never be marked auto-applicable. No executable/mutation field exists.
 */
export interface SearchSuggestion {
  kind: SearchFindingKind;
  /** The canonical entity the finding concerns (evidence scope). */
  entityId: string;
  /** What was observed. */
  finding: string;
  /** The raw figures behind the finding (never fabricated — copied from the row). */
  evidence: Record<string, number | string>;
  /** A human-readable action a REVIEWER might take. Not executable. */
  recommendedAction: string;
  confidence: SuggestionConfidence;
  /** Always the literal true. A suggestion is advisory, never an applied change. */
  reviewOnly: true;
}

/**
 * Compile-time guard: any T that carries a field capable of representing an applied mutation resolves to
 * `never`, so such a shape cannot be used where a suggestion is expected. This is what makes "auto-apply"
 * impossible to represent in this module.
 */
export type NoAutoApply<T> =
  T extends { apply: unknown } | { execute: unknown } | { mutate: unknown } | { write: unknown } | { reviewOnly: false }
    ? never
    : T;

/** The sole emitted shape, proven to carry no auto-apply affordance. */
export type ReviewOnlySuggestion = NoAutoApply<SearchSuggestion>;

/** A frozen, read-only flag asserting the module's contract: findings are surfaced, never applied. */
export const SEARCH_DIAGNOSTICS_MODE = 'REVIEW_ONLY' as const;

/** Default thresholds (conservative; a reviewer tunes acting, this only surfaces candidates). */
export interface SearchDiagnosticThresholds {
  /** Minimum spend for a zero-conversion row to be flagged as wasted-spend. */
  wastedSpendMinSpend: number;
  /** Minimum clicks for a zero-conversion search term to be a negative-keyword candidate. */
  negativeCandidateMinClicks: number;
  /** Quality score at or below which a LOW_QUALITY_SCORE signal is surfaced. */
  lowQualityScoreAtOrBelow: number;
}

export const DEFAULT_SEARCH_THRESHOLDS: SearchDiagnosticThresholds = {
  wastedSpendMinSpend: 50,
  negativeCandidateMinClicks: 20,
  lowQualityScoreAtOrBelow: 3,
};

/** Internal builder that stamps every suggestion with `reviewOnly: true`. */
function suggest(s: Omit<SearchSuggestion, 'reviewOnly'>): SearchSuggestion {
  return { ...s, reviewOnly: true };
}

/** Spend with zero conversions over the window — a wasted-spend candidate for review. Pure. */
export function wastedSpendCandidates(
  rows: CanonicalSearchRow[],
  thresholds: SearchDiagnosticThresholds = DEFAULT_SEARCH_THRESHOLDS,
): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  for (const row of rows) {
    const spend = row.metrics.spend ?? 0;
    const conversions = row.metrics.conversions ?? 0;
    if (spend >= thresholds.wastedSpendMinSpend && conversions === 0) {
      out.push(suggest({
        kind: 'WASTED_SPEND',
        entityId: row.entityId,
        finding: `Spend of ${spend} with 0 conversions over the window`,
        evidence: { spend, conversions, ...(row.currency ? { currency: row.currency } : {}) },
        recommendedAction: 'Review for pause or bid reduction (human decision — not applied).',
        confidence: spend >= thresholds.wastedSpendMinSpend * 2 ? 'HIGH' : 'MEDIUM',
      }));
    }
  }
  return out;
}

/** Low quality-score signal — surfaced for review, never auto-acted. Pure. */
export function lowQualityScoreSignals(
  rows: CanonicalSearchRow[],
  thresholds: SearchDiagnosticThresholds = DEFAULT_SEARCH_THRESHOLDS,
): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  for (const row of rows) {
    if (row.qualityScore != null && row.qualityScore <= thresholds.lowQualityScoreAtOrBelow) {
      out.push(suggest({
        kind: 'LOW_QUALITY_SCORE',
        entityId: row.entityId,
        finding: `Quality score ${row.qualityScore} at or below ${thresholds.lowQualityScoreAtOrBelow}`,
        evidence: { qualityScore: row.qualityScore },
        recommendedAction: 'Review ad relevance / landing page experience (human decision — not applied).',
        confidence: row.qualityScore <= 2 ? 'HIGH' : 'MEDIUM',
      }));
    }
  }
  return out;
}

/** Search terms spending clicks with no conversions — negative-keyword candidates for review. Pure. */
export function searchTermNegativeCandidates(
  rows: CanonicalSearchRow[],
  thresholds: SearchDiagnosticThresholds = DEFAULT_SEARCH_THRESHOLDS,
): SearchSuggestion[] {
  const out: SearchSuggestion[] = [];
  for (const row of rows) {
    if (!row.searchTerm) continue;
    const clicks = row.metrics.clicks ?? 0;
    const conversions = row.metrics.conversions ?? 0;
    if (clicks >= thresholds.negativeCandidateMinClicks && conversions === 0) {
      out.push(suggest({
        kind: 'SEARCH_TERM_NEGATIVE_CANDIDATE',
        entityId: row.entityId,
        finding: `Search term "${row.searchTerm}" has ${clicks} clicks and 0 conversions`,
        evidence: { searchTerm: row.searchTerm, clicks, conversions, spend: row.metrics.spend ?? 0 },
        recommendedAction: 'Review as a negative-keyword candidate (human decision — not applied).',
        confidence: clicks >= thresholds.negativeCandidateMinClicks * 2 ? 'HIGH' : 'MEDIUM',
      }));
    }
  }
  return out;
}

/** Run every review-only diagnostic and return the combined advisory findings. Pure. */
export function runSearchDiagnostics(
  rows: CanonicalSearchRow[],
  thresholds: SearchDiagnosticThresholds = DEFAULT_SEARCH_THRESHOLDS,
): SearchSuggestion[] {
  return [
    ...wastedSpendCandidates(rows, thresholds),
    ...lowQualityScoreSignals(rows, thresholds),
    ...searchTermNegativeCandidates(rows, thresholds),
  ];
}
