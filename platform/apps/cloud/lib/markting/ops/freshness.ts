import 'server-only';

/**
 * PHASE C (C9) — DATA FRESHNESS SLO taxonomy.
 *
 * A single, honest vocabulary for "how fresh is this data expected to be, and is it meeting that?".
 * This is a PURE model (no I/O): it classifies an observed read-age against a tier's staleness budget
 * so a surface can show an explicit freshness state instead of implying real-time where none exists.
 *
 * It does NOT fabricate freshness: `classifyFreshness` needs a real `readAt`; with none it returns
 * UNKNOWN (never FRESH). In DEMO the data is synthetic and carries no live SLO — callers pass
 * `tier: 'ON_DEMAND'` / a synthetic marker and the surface labels it DEMO, never a live SLO state.
 */

export const FRESHNESS_TIERS = ['NEAR_REALTIME', 'HOURLY', 'DAILY', 'ON_DEMAND'] as const;
export type FreshnessTier = (typeof FRESHNESS_TIERS)[number];

/**
 * Staleness budget per tier, in minutes: the age at which data stops being "fresh". A second,
 * larger "stale" threshold marks data old enough to be untrustworthy for a decision. ON_DEMAND has
 * no background refresh — it is fresh only at the moment it is pulled, so its budget is 0 (any age
 * beyond the current pull is AGING) and it never auto-goes STALE (there is nothing to be late).
 */
export interface FreshnessBudget {
  /** Age (minutes) up to which the read is FRESH. */
  freshWithinMinutes: number;
  /** Age (minutes) beyond which the read is STALE (between the two it is AGING). null = never auto-stale. */
  staleAfterMinutes: number | null;
  /** Human label for the expected cadence. */
  cadence: { en: string; ar: string };
}

export const FRESHNESS_BUDGETS: Record<FreshnessTier, FreshnessBudget> = {
  NEAR_REALTIME: { freshWithinMinutes: 15, staleAfterMinutes: 60, cadence: { en: 'near real-time (≤15 min)', ar: 'شبه فوري (≤15 دقيقة)' } },
  HOURLY: { freshWithinMinutes: 90, staleAfterMinutes: 360, cadence: { en: 'hourly', ar: 'كل ساعة' } },
  DAILY: { freshWithinMinutes: 36 * 60, staleAfterMinutes: 72 * 60, cadence: { en: 'daily', ar: 'يومي' } },
  ON_DEMAND: { freshWithinMinutes: 0, staleAfterMinutes: null, cadence: { en: 'on demand (pulled when asked)', ar: 'عند الطلب' } },
};

export type FreshnessState = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export interface FreshnessVerdict {
  tier: FreshnessTier;
  state: FreshnessState;
  /** Observed age in minutes, or null when readAt is unknown. */
  ageMinutes: number | null;
  budget: FreshnessBudget;
  /** True when the tier's SLO is being met (FRESH). Never true when state is UNKNOWN. */
  withinSlo: boolean;
}

/**
 * Classify an observed read against a tier. `readAt` and `now` are ISO strings / Dates; a missing or
 * unparseable `readAt` yields UNKNOWN (fail honest, never FRESH). A future `readAt` (clock skew) is
 * treated as age 0.
 */
export function classifyFreshness(
  tier: FreshnessTier,
  readAt: string | Date | null | undefined,
  now: string | Date = new Date(),
): FreshnessVerdict {
  const budget = FRESHNESS_BUDGETS[tier];
  const readMs = readAt == null ? NaN : new Date(readAt).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(readMs) || !Number.isFinite(nowMs)) {
    return { tier, state: 'UNKNOWN', ageMinutes: null, budget, withinSlo: false };
  }
  const ageMinutes = Math.max(0, Math.round((nowMs - readMs) / 60000));
  let state: FreshnessState;
  if (ageMinutes <= budget.freshWithinMinutes) state = 'FRESH';
  else if (budget.staleAfterMinutes != null && ageMinutes > budget.staleAfterMinutes) state = 'STALE';
  else state = 'AGING';
  return { tier, state, ageMinutes, budget, withinSlo: state === 'FRESH' };
}

/**
 * The expected freshness tier per data domain, grounded in how the data is actually sourced today.
 * Ad reads are on-demand (no background refresh job exists — AD_DEFAULTS.sync=false in the registry);
 * commerce can be webhook-driven (near real-time) where a verified signed webhook is wired, else the
 * incremental sync cadence. These are the HONEST expectations, not aspirational SLOs.
 */
export const DOMAIN_FRESHNESS: Record<string, FreshnessTier> = {
  MEDIA: 'ON_DEMAND',
  COMMERCE_WEBHOOK: 'NEAR_REALTIME',
  COMMERCE_SYNC: 'HOURLY',
  BREAKDOWN: 'ON_DEMAND',
  AI_NARRATION: 'ON_DEMAND',
};

export function freshnessLabel(verdict: FreshnessVerdict, locale: 'en' | 'ar'): string {
  const pick = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const cadence = locale === 'ar' ? verdict.budget.cadence.ar : verdict.budget.cadence.en;
  const age = verdict.ageMinutes == null ? pick('unknown age', 'عمر غير معروف')
    : verdict.ageMinutes < 60 ? `${verdict.ageMinutes}m`
    : `${Math.round(verdict.ageMinutes / 60)}h`;
  const state = {
    FRESH: pick('fresh', 'حديث'),
    AGING: pick('aging', 'يتقادم'),
    STALE: pick('stale', 'قديم'),
    UNKNOWN: pick('freshness unknown', 'حداثة غير معروفة'),
  }[verdict.state];
  return `${state} · ${cadence} · ${age}`;
}
