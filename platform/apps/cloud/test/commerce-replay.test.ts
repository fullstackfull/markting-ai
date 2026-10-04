import { describe, expect, it } from 'vitest';
import {
  REPLAY_CONTRACTS, runReplayContract, checkReplayContract, assertMerchantTruthOnly,
} from '@/lib/markting/commerce/replay-contracts';
import type { Order } from '@/lib/markting/commerce/model';

describe('ITEM 12 — commerce replay contracts (FIXTURE_PROVEN)', () => {
  it('covers all four real platforms', () => {
    expect(REPLAY_CONTRACTS.map((c) => c.platform).sort()).toEqual(['salla', 'shopify', 'woocommerce', 'zid']);
    for (const c of REPLAY_CONTRACTS) expect(c.classification).toBe('FIXTURE_PROVEN');
  });

  for (const contract of REPLAY_CONTRACTS) {
    it(`${contract.name}: captured sample maps to the expected canonical entities`, async () => {
      const got = await runReplayContract(contract);
      const failures = checkReplayContract(contract, got);
      expect(failures).toEqual([]);
      // canonical entities are present as declared
      expect(got.order).toBeTruthy();
      expect(got.product).toBeTruthy();
      expect(got.refund).toBeTruthy();
    });

    it(`${contract.name}: mapping reports MERCHANT TRUTH only (no ad-conversion inference)`, async () => {
      const got = await runReplayContract(contract);
      expect(() => assertMerchantTruthOnly(got.order!, contract.merchantTruth)).not.toThrow();
      // the ad conversion value is preserved in raw but never flows into canonical money
      expect(got.order!.raw!.ad_conversion_value).toBeDefined();
      expect(got.order!.grossTotal.minorUnits).toBe(contract.merchantTruth.merchantGrossMinor);
      expect(got.order!.grossTotal.minorUnits).not.toBe(contract.merchantTruth.adConversionValueMinor);
      // connector layer never infers COGS or netRevenue
      for (const l of got.order!.lines) expect(l.cogs).toBeUndefined();
      expect(got.order!.netRevenue).toBeUndefined();
    });
  }

  it('the invariant FAILS when revenue is derived from ad conversion value', () => {
    const tampered = {
      grossTotal: { minorUnits: 77700, currency: 'USD' },
      subtotal: { minorUnits: 9000, currency: 'USD' },
      lines: [],
    } as unknown as Order;
    // gross equals the planted ad conversion value (77700) and differs from merchant truth (9500)
    expect(() => assertMerchantTruthOnly(tampered, { adConversionValueMinor: 77700, merchantGrossMinor: 9500 }))
      .toThrow(/MERCHANT_TRUTH_VIOLATION/);
  });

  it('the invariant FAILS when COGS is inferred at the connector layer', () => {
    const withCogs = {
      grossTotal: { minorUnits: 9500, currency: 'USD' },
      subtotal: { minorUnits: 9000, currency: 'USD' },
      lines: [{ lineId: 'l1', cogs: { minorUnits: 1000, currency: 'USD' } }],
    } as unknown as Order;
    expect(() => assertMerchantTruthOnly(withCogs, { adConversionValueMinor: 77700, merchantGrossMinor: 9500 }))
      .toThrow(/COGS inferred/);
  });

  it('the invariant FAILS when netRevenue is computed without an explicit basis', () => {
    const withNet = {
      grossTotal: { minorUnits: 9500, currency: 'USD' },
      subtotal: { minorUnits: 9000, currency: 'USD' },
      lines: [],
      netRevenue: { minorUnits: 9000, currency: 'USD' },
    } as unknown as Order;
    expect(() => assertMerchantTruthOnly(withNet, { adConversionValueMinor: 77700, merchantGrossMinor: 9500 }))
      .toThrow(/netRevenue/);
  });
});
