import { describe, expect, it } from 'vitest';
import { requiredConversionsPerArm, assessSample } from '@/lib/markting/optimize/sample';
import { analyzePacing } from '@/lib/markting/intelligence/pacing';
import { reconcile } from '@/lib/markting/commerce/reconciliation';
import { detectAnomalies } from '@/lib/markting/intelligence/anomaly';

const SAR = (minorUnits: number) => ({ minorUnits, currency: 'SAR' });

describe('Wave 2 — sample-size unit correction (P1 #1)', () => {
  it('returns CONVERSIONS per arm (~16(1-p)/mde²), not the visitor count (~1/p larger)', () => {
    // p=0.02, mde=10% → correct conversions ≈ 16·0.98/0.01 = 1568 (old bug returned 16/(0.01·0.02)=80000).
    const n = requiredConversionsPerArm({ minConversionsPerArm: 0, baselineRate: 0.02, minimumDetectableEffectPct: 10, minDurationDays: 14 });
    expect(n).toBeGreaterThan(1500);
    expect(n).toBeLessThan(1600);
    expect(n).toBeLessThan(80000); // the old visitor-count magnitude is gone
  });
  it('scales with the square of the relative effect, independent of p beyond the (1-p) term', () => {
    const mde10 = requiredConversionsPerArm({ minConversionsPerArm: 0, baselineRate: 0.05, minimumDetectableEffectPct: 10, minDurationDays: 7 });
    const mde20 = requiredConversionsPerArm({ minConversionsPerArm: 0, baselineRate: 0.05, minimumDetectableEffectPct: 20, minDurationDays: 7 });
    expect(Math.round(mde10 / mde20)).toBe(4); // halving sensitivity quarters the requirement
  });
  it('still honours an explicit floor (unchanged path)', () => {
    const v = assessSample({ minConversionsPerArm: 100, minDurationDays: 14 }, { conversionsPerArm: 10, durationDays: 7 });
    expect(v.readiness).toBe('EXPERIMENT_NOT_READY');
    expect(v.requiredConversionsPerArm).toBe(100);
  });
});

describe('Wave 2 — pacing early-period projection guard (P2 #9)', () => {
  it('withholds the projection when too little of the period has elapsed', () => {
    const p = analyzePacing({ spendToDate: 10, plannedBudget: 30000, daysElapsed: 0.1, daysInPeriod: 30, kind: 'monthly' });
    expect(p.projectedOverUnderPct).toBeUndefined();
    expect(p.projectedSpend).toBe(10); // floor, not an exploded 3000x extrapolation
    expect(p.reasons.join(' ')).toContain('too early');
  });
  it('still projects once enough of the period has elapsed (unchanged behaviour)', () => {
    const p = analyzePacing({ spendToDate: 900, plannedBudget: 1000, daysElapsed: 4, daysInPeriod: 10, kind: 'period' });
    expect(p.status).toBe('OVERPACING');
    expect(p.projectedSpend).toBeGreaterThan(1000);
    expect(p.projectedOverUnderPct).toBeGreaterThan(0);
  });
});

describe('Wave 2 — reconciliation sample-awareness (P1 #4)', () => {
  it('keeps a large gap MATERIAL at a normal sample (n>=5) — existing behaviour preserved', () => {
    const r = reconcile({ platformRevenue: SAR(100000), merchantRevenue: SAR(50000), merchantOrderCount: 5 });
    expect(r.state).toBe('MATERIAL_VARIANCE');
    expect(r.sampleSufficiency).toBe('LOW'); // 5 < 25 → flagged low, but state unchanged
  });
  it('widens thresholds for a tiny sample so a 3-order account is not falsely MATERIAL', () => {
    const r = reconcile({ platformRevenue: SAR(100000), merchantRevenue: SAR(55000), merchantOrderCount: 3 });
    // 45% gap at n=3: widened material threshold (35%*1.4=49%) → EXPECTED_VARIANCE, not MATERIAL.
    expect(r.state).toBe('EXPECTED_VARIANCE');
    expect(r.sampleSufficiency).toBe('LOW');
  });
  it('marks an adequate sample ADEQUATE', () => {
    const r = reconcile({ platformRevenue: SAR(100000), merchantRevenue: SAR(95000), merchantOrderCount: 40 });
    expect(r.sampleSufficiency).toBe('ADEQUATE');
  });
});

describe('Wave 2 — anomaly baseline + anchored seasonality (P1 #2/#3)', () => {
  it('still flags a genuine spike (baseline now excludes the point, de-masking it)', () => {
    const r = detectAnomalies([100, 102, 98, 101, 99, 100, 400]);
    expect(r.actionable).toBe(true);
    expect(['ACTIONABLE', 'CRITICAL']).toContain(r.top!.classification);
  });
  it('does not flag a steady series', () => {
    expect(detectAnomalies([100, 102, 98, 101, 99, 100, 103]).actionable).toBe(false);
  });
  it('does NOT apply seasonal adjustment without anchored weekdays (no index%7 guessing)', () => {
    const series = Array.from({ length: 21 }, (_, i) => (i % 7 === 5 || i % 7 === 6 ? 50 : 100));
    expect(detectAnomalies(series).seasonallyAdjusted).toBe(false);
  });
  it('applies seasonal adjustment only when weekdays are supplied, removing a normal weekend dip', () => {
    const weekdays = Array.from({ length: 21 }, (_, i) => i % 7); // anchored 0..6
    const series = weekdays.map((d) => (d === 5 || d === 6 ? 50 : 100)); // weekend dip
    const r = detectAnomalies(series, { weekdays });
    expect(r.seasonallyAdjusted).toBe(true);
    expect(r.actionable).toBe(false); // the recurring weekend dip is seasonal, not an anomaly
  });
});
