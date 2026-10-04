import { describe, expect, it } from 'vitest';
import { classifyFreshness, freshnessLabel, FRESHNESS_TIERS, DOMAIN_FRESHNESS } from '@/lib/markting/ops/freshness';

/**
 * PHASE C (C9) — freshness-tier classification. Pure; fails honest (UNKNOWN, never FRESH) without a
 * real read time; respects each tier's staleness budget.
 */
const NOW = '2026-10-04T12:00:00Z';
const ago = (min: number) => new Date(Date.parse(NOW) - min * 60000).toISOString();

describe('C9 — classifyFreshness', () => {
  it('NEAR_REALTIME: fresh ≤15m, aging to 60m, stale beyond', () => {
    expect(classifyFreshness('NEAR_REALTIME', ago(5), NOW).state).toBe('FRESH');
    expect(classifyFreshness('NEAR_REALTIME', ago(30), NOW).state).toBe('AGING');
    expect(classifyFreshness('NEAR_REALTIME', ago(120), NOW).state).toBe('STALE');
  });

  it('HOURLY: fresh ≤90m, stale beyond 6h', () => {
    expect(classifyFreshness('HOURLY', ago(45), NOW).state).toBe('FRESH');
    expect(classifyFreshness('HOURLY', ago(200), NOW).state).toBe('AGING');
    expect(classifyFreshness('HOURLY', ago(500), NOW).state).toBe('STALE');
  });

  it('DAILY: fresh within ~1.5 days', () => {
    expect(classifyFreshness('DAILY', ago(20 * 60), NOW).state).toBe('FRESH');
    expect(classifyFreshness('DAILY', ago(48 * 60), NOW).state).toBe('AGING');
    expect(classifyFreshness('DAILY', ago(96 * 60), NOW).state).toBe('STALE');
  });

  it('ON_DEMAND: fresh only at pull; never auto-stale', () => {
    expect(classifyFreshness('ON_DEMAND', ago(0), NOW).state).toBe('FRESH');
    expect(classifyFreshness('ON_DEMAND', ago(10), NOW).state).toBe('AGING');
    expect(classifyFreshness('ON_DEMAND', ago(100000), NOW).state).toBe('AGING'); // no stale threshold
  });

  it('fails honest: unknown/malformed readAt → UNKNOWN, never FRESH, withinSlo false', () => {
    for (const tier of FRESHNESS_TIERS) {
      const v = classifyFreshness(tier, null, NOW);
      expect(v.state).toBe('UNKNOWN');
      expect(v.withinSlo).toBe(false);
      expect(v.ageMinutes).toBeNull();
    }
    expect(classifyFreshness('HOURLY', 'not-a-date', NOW).state).toBe('UNKNOWN');
  });

  it('clock skew (future readAt) is treated as age 0 → FRESH', () => {
    expect(classifyFreshness('HOURLY', new Date(Date.parse(NOW) + 60000).toISOString(), NOW).ageMinutes).toBe(0);
  });

  it('labels are bilingual and include state + cadence + age', () => {
    const v = classifyFreshness('HOURLY', ago(45), NOW);
    expect(freshnessLabel(v, 'en')).toMatch(/fresh/);
    expect(freshnessLabel(v, 'ar')).toMatch(/حديث/);
  });

  it('ad/breakdown domains are ON_DEMAND (no background refresh exists today)', () => {
    expect(DOMAIN_FRESHNESS.MEDIA).toBe('ON_DEMAND');
    expect(DOMAIN_FRESHNESS.BREAKDOWN).toBe('ON_DEMAND');
    expect(DOMAIN_FRESHNESS.COMMERCE_WEBHOOK).toBe('NEAR_REALTIME');
  });
});
