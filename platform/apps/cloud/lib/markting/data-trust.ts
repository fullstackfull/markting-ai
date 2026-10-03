/**
 * Deterministic data-trust floor (R0-11). Before any number drives a surfaced recommendation, it
 * must carry explicit provenance, and a recommendation built on thin/unsettled/synthetic data must
 * be allowed to say INSUFFICIENT_EVIDENCE instead of manufacturing certainty. This is a conservative
 * gate, NOT a statistics engine: it does not compute significance or confidence scores. It only
 * enforces that evidence EXISTS and is classified before a write proposal is surfaced as actionable.
 */

/** Ordered from least to most trustworthy. */
export const TRUST_TIERS = ['UNVERIFIED', 'PLATFORM_REPORTED', 'VALIDATED', 'RECONCILED'] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

/** Synthetic/demo data is isolated from the live tiers entirely — it may never read as live evidence. */
export type DataTier = TrustTier | 'SYNTHETIC';

export interface DataTrust {
  tier: DataTier;
  /** e.g. 'sandbox-fixture', 'pipeboard', 'adport-report'. */
  source: string;
  /** ISO timestamp of the underlying data, when known. */
  freshnessAt?: string;
  /** Reporting currency of the figures, when monetary. */
  currency?: string;
  /** IANA timezone the date range is expressed in, when known. */
  timezone?: string;
  /** Attribution basis label (e.g. 'omni_purchase 7d-click'), when known. */
  attributionBasis?: string;
  /** Inclusive reporting window [start, end] as ISO dates, when known. */
  dateRange?: { start: string; end: string };
  /** Number of conversions/observations behind a ratio, when known. */
  sampleSize?: number;
  /** True only when the window is closed and totals are not partial. */
  complete?: boolean;
  /** True only when figures were reconciled against an authoritative source. */
  validated?: boolean;
}

export interface EvidenceVerdict {
  /** Whether a recommendation may be surfaced as actionable at all. */
  actionable: boolean;
  /** The reason code when not actionable. */
  code?: 'INSUFFICIENT_EVIDENCE';
  /** Human-readable reasons (never fabricated confidence). */
  reasons: string[];
  tier: DataTier;
}

/**
 * The minimum sample size below which no ratio-based recommendation (CPA/ROAS-driven) may claim
 * confidence. Deliberately simple and conservative; a real significance engine is Phase 3+ work.
 */
export const MIN_SAMPLE_FOR_CONFIDENCE = 30;

/**
 * Classify whether the evidence behind a proposed change clears the Phase-0 floor. Synthetic data is
 * never "actionable" as live evidence (it is fine for demo previews, which the caller distinguishes
 * by runtime mode). Live data must be at least PLATFORM_REPORTED, from a closed window, with enough
 * sample behind any ratio it relies on.
 */
export function evaluateEvidence(
  trust: DataTrust,
  opts: { ratioBased?: boolean; asOf?: string; maxAgeMs?: number } = {},
): EvidenceVerdict {
  const reasons: string[] = [];
  if (trust.tier === 'SYNTHETIC') {
    return { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons: ['synthetic/demo data is not live evidence'], tier: trust.tier };
  }
  if (trust.tier === 'UNVERIFIED') reasons.push('data tier is UNVERIFIED');
  if (trust.complete === false) reasons.push('reporting window is still open (partial data)');
  if (opts.ratioBased && (trust.sampleSize ?? 0) < MIN_SAMPLE_FOR_CONFIDENCE) {
    reasons.push(`sample size ${trust.sampleSize ?? 0} is below the ${MIN_SAMPLE_FOR_CONFIDENCE}-observation floor for a ratio-based recommendation`);
  }
  // Staleness floor: old-but-complete data is not current evidence. When a bound is supplied, the data's
  // age is measured from its freshness timestamp, else the inclusive end of its reporting window.
  if (opts.maxAgeMs != null) {
    const asOf = opts.asOf ? Date.parse(opts.asOf) : Date.now();
    const dataAtIso = trust.freshnessAt ?? (trust.dateRange ? `${trust.dateRange.end}T23:59:59.999Z` : undefined);
    const dataAt = dataAtIso ? Date.parse(dataAtIso) : NaN;
    if (!Number.isFinite(dataAt)) {
      reasons.push('data freshness is unknown; cannot confirm the figures are current');
    } else if (Number.isFinite(asOf) && asOf - dataAt > opts.maxAgeMs) {
      reasons.push(`data is stale (older than ${Math.round(opts.maxAgeMs / 86_400_000)}d); refresh before acting`);
    }
  }
  const actionable = reasons.length === 0;
  return actionable
    ? { actionable: true, reasons: [], tier: trust.tier }
    : { actionable: false, code: 'INSUFFICIENT_EVIDENCE', reasons, tier: trust.tier };
}

/** Fixtures always carry the SYNTHETIC tier so they can never be mistaken for live evidence. */
export const SYNTHETIC_TRUST: DataTrust = { tier: 'SYNTHETIC', source: 'sandbox-fixture', complete: true };
