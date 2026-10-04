import { describe, expect, it } from 'vitest';
import { summarizeLiveRows, type LiveReportRow } from '@/lib/cloud/live-summary';

/**
 * PHASE A (A1) regression: the live overview must never sum provider-claimed conversions across
 * providers, never blend ROAS across providers, and never blend spend across currencies.
 */
const rows: LiveReportRow[] = [
  { provider: 'meta', currency: 'USD', metrics: { impressions: 1000, clicks: 100, spend: 200, conversions: 10, conversion_value: 800 } },
  { provider: 'meta', currency: 'USD', metrics: { impressions: 500, clicks: 50, spend: 100, conversions: 5, conversion_value: 400 } },
  { provider: 'google', currency: 'SAR', metrics: { impressions: 2000, clicks: 300, spend: 900, conversions: 20, conversion_value: 1800 } },
];

describe('summarizeLiveRows (A1 — no cross-provider conversion blending)', () => {
  const s = summarizeLiveRows(rows);

  it('sums impressions/clicks (raw counts) across everything', () => {
    expect(s.impressions).toBe(3500);
    expect(s.clicks).toBe(450);
  });

  it('keeps conversions PER PROVIDER — never one blended number', () => {
    const meta = s.perProvider.find((p) => p.provider === 'meta')!;
    const google = s.perProvider.find((p) => p.provider === 'google')!;
    expect(meta.conversions).toBe(15); // summed WITHIN meta only
    expect(google.conversions).toBe(20);
    // There is deliberately no single blended conversions field on the summary.
    expect((s as unknown as { conversions?: number }).conversions).toBeUndefined();
  });

  it('computes ROAS per provider (single currency), never blended across providers', () => {
    const meta = s.perProvider.find((p) => p.provider === 'meta')!;
    const google = s.perProvider.find((p) => p.provider === 'google')!;
    expect(meta.roas).toBeCloseTo(1200 / 300, 6); // 4.0
    expect(google.roas).toBeCloseTo(1800 / 900, 6); // 2.0
  });

  it('keeps spend per currency — never blended across currencies (no invented FX)', () => {
    const usd = s.spendByCurrency.find((c) => c.currency === 'USD')!;
    const sar = s.spendByCurrency.find((c) => c.currency === 'SAR')!;
    expect(usd.spend).toBe(300);
    expect(sar.spend).toBe(900);
    expect(s.spendByCurrency).toHaveLength(2);
  });

  it('suppresses a provider ROAS when that provider spans multiple currencies', () => {
    const multi = summarizeLiveRows([
      { provider: 'meta', currency: 'USD', metrics: { spend: 100, conversion_value: 400 } },
      { provider: 'meta', currency: 'SAR', metrics: { spend: 100, conversion_value: 400 } },
    ]);
    expect(multi.perProvider[0]!.roas).toBeUndefined();
  });
});
