/**
 * PHASE A (A1) — safe aggregation for the live overview headline.
 *
 * Pure + deterministic (no DB, no server-only) so it is unit-testable and reusable. The ONE rule this
 * encodes: provider-claimed CONVERSIONS and conversion-value are NOT comparable across providers (each
 * provider has its own conversion definition, attribution window and dedup), so they are NEVER summed
 * into a single headline. Impressions/clicks are raw delivery counts (no attribution, no currency) and
 * are safe to sum. Spend is real money, summed only within a currency (never across — no invented FX).
 */
export interface LiveReportRow {
  provider: string;
  currency?: string;
  metrics: Record<string, number>;
}

export interface ProviderSummary {
  provider: string;
  conversions: number;
  spend: number;
  value: number;
  currencies: string[];
  /** ROAS only when the provider reports a single currency and positive spend; else undefined. */
  roas?: number;
}

export interface LiveSummary {
  impressions: number;
  clicks: number;
  /** Spend per currency — never blended across currencies. */
  spendByCurrency: Array<{ currency: string; spend: number }>;
  /** Per-provider conversions + ROAS — never blended across providers. */
  perProvider: ProviderSummary[];
}

export function summarizeLiveRows(rows: LiveReportRow[]): LiveSummary {
  let impressions = 0;
  let clicks = 0;
  for (const row of rows) {
    impressions += row.metrics.impressions ?? 0;
    clicks += row.metrics.clicks ?? 0;
  }

  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    const ccy = row.currency ?? '';
    byCurrency.set(ccy, (byCurrency.get(ccy) ?? 0) + (row.metrics.spend ?? 0));
  }

  const byProvider = new Map<string, { conversions: number; spend: number; value: number; currencies: Set<string> }>();
  for (const row of rows) {
    const acc = byProvider.get(row.provider) ?? { conversions: 0, spend: 0, value: 0, currencies: new Set<string>() };
    acc.conversions += row.metrics.conversions ?? 0;
    acc.spend += row.metrics.spend ?? 0;
    acc.value += row.metrics.conversion_value ?? 0;
    if (row.currency) acc.currencies.add(row.currency);
    byProvider.set(row.provider, acc);
  }

  return {
    impressions,
    clicks,
    spendByCurrency: [...byCurrency.entries()].map(([currency, spend]) => ({ currency, spend })),
    perProvider: [...byProvider.entries()].map(([provider, m]) => ({
      provider,
      conversions: m.conversions,
      spend: m.spend,
      value: m.value,
      currencies: [...m.currencies],
      roas: m.currencies.size <= 1 && m.spend > 0 ? m.value / m.spend : undefined,
    })),
  };
}
