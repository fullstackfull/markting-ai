/**
 * Phase 6 — GOVERNED FX. Cross-currency allocation stays BLOCKED unless a trustworthy rate source is
 * supplied. Every conversion records source + rate + timestamp + base currency. An LLM-provided rate is
 * NEVER accepted. Without a governed rate, cross-currency candidates are NOT_COMPARABLE (no blending).
 */
export interface GovernedFxRate { from: string; to: string; rate: number; source: string; asOf: string }

export interface FxRegistry { rate(from: string, to: string): GovernedFxRate | null }

/** A fixed, explicitly-sourced registry (e.g. a treasury feed snapshot). Never model-supplied. */
export function governedFxRegistry(rates: GovernedFxRate[]): FxRegistry {
  const key = (f: string, t: string) => `${f}->${t}`;
  const map = new Map(rates.map((r) => [key(r.from, r.to), r]));
  return {
    rate(from, to) {
      if (from === to) return { from, to, rate: 1, source: 'identity', asOf: '1970-01-01T00:00:00.000Z' };
      return map.get(key(from, to)) ?? null;
    },
  };
}

export type FxConversion = { ok: true; minorUnits: number; currency: string; applied: GovernedFxRate } | { ok: false; reason: string };

/** Convert money to a base currency via the governed registry, or refuse (NOT_COMPARABLE). */
export function convertToBase(amountMinor: number, from: string, base: string, registry?: FxRegistry): FxConversion {
  if (from === base) return { ok: true, minorUnits: amountMinor, currency: base, applied: { from, to: base, rate: 1, source: 'identity', asOf: '1970-01-01T00:00:00.000Z' } };
  if (!registry) return { ok: false, reason: `cross-currency ${from}->${base} blocked — no governed FX registry` };
  const r = registry.rate(from, base);
  if (!r) return { ok: false, reason: `no governed rate ${from}->${base}` };
  return { ok: true, minorUnits: Math.round(amountMinor * r.rate), currency: base, applied: r };
}

export function crossCurrencyAllowed(currencies: string[], registry?: FxRegistry, base?: string): { allowed: boolean; reason?: string } {
  const distinct = [...new Set(currencies)];
  if (distinct.length <= 1) return { allowed: true };
  if (!registry || !base) return { allowed: false, reason: 'cross-currency allocation blocked (no governed FX)' };
  for (const c of distinct) if (!registry.rate(c, base)) return { allowed: false, reason: `no governed rate ${c}->${base}` };
  return { allowed: true };
}
