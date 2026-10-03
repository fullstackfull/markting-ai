import { describe, expect, it } from 'vitest';
import { moneyFromMinor } from '@adport/core';
import {
  MarketingIntelligenceOrchestrator, scoreFactor, type OrchestratorInput,
} from '@/lib/markting/orchestrator/orchestrator';
import {
  fromCommerceMoney, tryFromCommerceMoney, toCommerceMoney, compareMoney, formatMoney,
} from '@/lib/markting/orchestrator/money';
import {
  weakestTier, fromCommerceOrderTiers, fromMemoryTrust, summarizeTrust,
} from '@/lib/markting/orchestrator/trust';
import {
  fromMediaRecommendation, fromCommerceRecommendation, rankRecommendations,
} from '@/lib/markting/orchestrator/recommendation';
import type { Diagnosis, Recommendation } from '@/lib/markting/intelligence/decision-model';
import type { CommerceDiagnosis, CommerceRecommendation } from '@/lib/markting/commerce/diagnostics';
import type { CreativeRecommendation } from '@/lib/markting/creative/recommendations';
import type { IntelligenceRequestContext } from '@/lib/markting/orchestrator/context';

const ctx: IntelligenceRequestContext = {
  organizationId: 'org-1', userId: 'user-1', permissions: ['tools:read'],
  accountId: 'google:acc:1', provider: 'google', runtimeMode: 'LIVE_RECOMMENDATIONS',
  reportingCurrency: 'SAR', period: { start: '2026-09-01', end: '2026-09-30' },
  comparisonPeriod: { start: '2026-08-01', end: '2026-08-31' },
};

const orch = new MarketingIntelligenceOrchestrator();

describe('Program 1.4 — one Money model at the boundary', () => {
  it('lifts commerce {minorUnits,currency} to canonical Money, recovering the exponent', () => {
    expect(fromCommerceMoney({ minorUnits: 123450, currency: 'SAR' })).toEqual(moneyFromMinor('SAR', 123450));
    // Zero-decimal currency keeps its exponent (the bug CommerceMoney could not prevent).
    expect(fromCommerceMoney({ minorUnits: 5000, currency: 'JPY' })).toEqual({ currency: 'JPY', minor: 5000, exponent: 0 });
    // Three-decimal currency.
    expect(fromCommerceMoney({ minorUnits: 1500, currency: 'KWD' })).toEqual({ currency: 'KWD', minor: 1500, exponent: 3 });
  });
  it('fails closed on an unknown currency; the safe variant returns undefined', () => {
    expect(() => fromCommerceMoney({ minorUnits: 1, currency: 'ZZZ' })).toThrow();
    expect(tryFromCommerceMoney({ minorUnits: 1, currency: 'ZZZ' })).toBeUndefined();
  });
  it('round-trips and formats without float math', () => {
    const m = fromCommerceMoney({ minorUnits: 123450, currency: 'SAR' });
    expect(toCommerceMoney(m)).toEqual({ minorUnits: 123450, currency: 'SAR' });
    expect(formatMoney(m)).toBe('1234.50');
    expect(formatMoney({ currency: 'JPY', minor: 5000, exponent: 0 })).toBe('5000');
  });
  it('never blends currencies — cross-currency comparison is undefined', () => {
    expect(compareMoney(moneyFromMinor('SAR', 100), moneyFromMinor('USD', 100))).toBeUndefined();
    expect(compareMoney(moneyFromMinor('SAR', 200), moneyFromMinor('SAR', 100))).toBeGreaterThan(0);
  });
});

describe('Program 1.3 — one trust vocabulary', () => {
  it('ranks weakest-first and maps domain tiers onto the canonical DataTier', () => {
    expect(weakestTier('RECONCILED', 'PLATFORM_REPORTED', 'VALIDATED')).toBe('PLATFORM_REPORTED');
    expect(fromCommerceOrderTiers(['PAID_ORDER', 'REFUND_VERIFIED'])).toBe('PLATFORM_REPORTED'); // capped by weakest
    expect(fromMemoryTrust('EXPLICIT_HUMAN')).toBe('VALIDATED');
    expect(fromMemoryTrust('DERIVED')).toBe('UNVERIFIED');
  });
  it('flags synthetic data as not-live in a trust summary', () => {
    const s = summarizeTrust([{ tier: 'PLATFORM_REPORTED' }, { tier: 'SYNTHETIC' }]);
    expect(s.live).toBe(false);
    expect(s.tier).toBe('SYNTHETIC');
    expect(s.notes.join(' ')).toContain('synthetic');
  });
});

describe('Program 1.5 — one recommendation pipeline', () => {
  const mediaRec: Recommendation = {
    recommendationId: 'm1', organizationId: 'org-1', accountId: 'google:acc:1',
    entityScope: { entityId: 'google:acc:1:camp:9', entityLevel: 'campaign', name: 'Brand Search' },
    category: 'DELIVERY_REVIEW', actionType: 'REVIEW_DELIVERY',
    diagnosis: { type: 'CPA_DETERIORATION', scope: { organizationId: 'org-1', accountId: 'google:acc:1', entityId: 'google:acc:1:camp:9', entityLevel: 'campaign' }, severity: 'ATTENTION', summary: { en: 'CPA up', ar: 'ارتفاع CPA' }, evidence: [], confidence: 'HIGH', dataTrust: 'PLATFORM_REPORTED' },
    reasoning: { en: 'Review delivery', ar: 'راجع التسليم' }, evidence: [], confidence: 'HIGH', risk: 'MODERATE',
    dataTrust: 'PLATFORM_REPORTED', expectedImpact: 'NEGATIVE_RISK_REDUCTION',
    alternatives: [{ actionType: 'NO_ACTION', rationale: { en: 'keep observing', ar: 'استمر بالمراقبة' } }],
    requiresHumanApproval: true, status: 'REVIEWABLE', expiresAt: '2026-10-07T00:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z',
  };
  const commerceRec: CommerceRecommendation = {
    organizationId: 'org-1', scope: { storeId: 'salla:1' }, category: 'PROFITABILITY_REVIEW',
    reasoning: { en: 'Profit review', ar: 'مراجعة الربح' }, evidence: { x: 1 }, confidence: 'MEDIUM', risk: 'HIGH',
    dataTrust: 'RECONCILED', requiresHumanApproval: true,
  };

  it('maps every domain onto one UnifiedRecommendation and ranks by risk then confidence', () => {
    const unified = rankRecommendations([
      fromMediaRecommendation(mediaRec),
      fromCommerceRecommendation(commerceRec, { id: 'c1', createdAt: '2026-10-01T00:00:00.000Z' }),
    ]);
    expect(unified.map((r) => r.domain)).toEqual(['COMMERCE', 'MEDIA']); // HIGH risk first
    expect(unified.every((r) => r.requiresHumanApproval === true)).toBe(true);
    expect(unified[0]!.category).toBe('COMMERCE:PROFITABILITY_REVIEW');
    expect(unified[0]!.evidenceDetail).toEqual({ x: 1 }); // native evidence preserved
  });
});

describe('Programs 1+2 — orchestrator composes a cross-domain diagnosis', () => {
  const commerceDiagnoses: CommerceDiagnosis[] = [
    { type: 'REFUNDS_ERODE_NET_REVENUE', severity: 'MATERIAL', summary: { en: 'Refunds erode net revenue', ar: 'الاستردادات تآكل صافي الإيراد' }, evidence: { refundRateByValue: 0.22 } },
    { type: 'REVENUE_UP_PROFIT_DOWN', severity: 'MATERIAL', summary: { en: 'Revenue up, profit down', ar: 'الإيراد صاعد والربح هابط' }, evidence: {} },
  ];
  const mediaDiagnoses: Diagnosis[] = [
    { type: 'CPA_DETERIORATION', scope: { organizationId: 'org-1', accountId: 'google:acc:1', entityId: 'google:acc:1:camp:9', entityLevel: 'campaign' }, severity: 'WATCH', summary: { en: 'CPA deteriorating on Campaign Y', ar: 'تدهور CPA في الحملة Y' }, evidence: [], confidence: 'MEDIUM', dataTrust: 'PLATFORM_REPORTED' },
  ];
  const creativeRecs: CreativeRecommendation[] = [
    { organizationId: 'org-1', accountId: 'google:acc:1', scope: { clusterId: 'cl-1' }, category: 'CREATIVE_FATIGUE_REVIEW', reasoning: { en: 'Fatigue on dominant cluster', ar: 'إجهاد في العنقود المهيمن' }, evidence: { signals: ['ctr_decline'] }, confidence: 'MEDIUM', risk: 'MODERATE', dataTrust: 'PLATFORM_REPORTED', comparability: 'PARTIALLY_COMPARABLE', expectedImpact: 'NEGATIVE_RISK_REDUCTION', requiresHumanApproval: true },
  ];

  it('answers "why did profitability decline and what should I do?" across domains', () => {
    const input: OrchestratorInput = {
      context: ctx, intent: 'PROFITABILITY_DECLINE',
      media: { diagnoses: mediaDiagnoses },
      commerce: { diagnoses: commerceDiagnoses, recommendations: [{ organizationId: 'org-1', scope: {}, category: 'REFUND_RATE_REVIEW', reasoning: { en: 'Review refunds', ar: 'راجع الاستردادات' }, evidence: {}, confidence: 'MEDIUM', risk: 'MODERATE', dataTrust: 'RECONCILED', requiresHumanApproval: true }] },
      creative: { recommendations: creativeRecs },
      materiality: { 'COMMERCE:REFUNDS_ERODE_NET_REVENUE': 0.6 },
    };
    const result = orch.compose(input);

    // Composed, not three disconnected findings: a single headline naming the dominant domains.
    expect(result.diagnosis.headline.en).toContain('merchant-side');
    expect(result.diagnosis.headline.ar.length).toBeGreaterThan(0);

    // The commerce MATERIAL+materiality factor outranks the media WATCH factor (deterministic).
    expect(result.diagnosis.factors[0]!.domain).toBe('COMMERCE');
    expect(result.diagnosis.factors[0]!.key).toBe('COMMERCE:REFUNDS_ERODE_NET_REVENUE');
    expect(result.diagnosis.factors.map((f) => f.domain)).toContain('CREATIVE');

    // One recommended next action; here the top factor is MATERIAL (ATTENTION) → REVIEW.
    expect(result.nextAction).toBe('REVIEW');
    expect(result.nextBestQuestion?.en).toContain('refund');

    // Unified recommendations from every contributing domain, nothing executes.
    expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(result.recommendations.every((r) => r.requiresHumanApproval === true)).toBe(true);

    // Domain availability is explicit.
    const byDomain = Object.fromEntries(result.domains.map((d) => [d.domain, d.state]));
    expect(byDomain.COMMERCE).toBe('CONTRIBUTED');
    expect(byDomain.MEDIA).toBe('CONTRIBUTED');
    expect(byDomain.CREATIVE).toBe('CONTRIBUTED');
  });

  it('reports INSUFFICIENT_EVIDENCE and honest unavailability when nothing contributes', () => {
    const result = orch.compose({
      context: ctx, intent: 'PROFITABILITY_DECLINE',
      availability: { COMMERCE: 'NOT_CONNECTED' },
    });
    expect(result.nextAction).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.diagnosis.factors).toEqual([]);
    const byDomain = Object.fromEntries(result.domains.map((d) => [d.domain, d.state]));
    expect(byDomain.COMMERCE).toBe('NOT_CONNECTED');
  });

  it('scoreFactor ranks severity over materiality over confidence, deterministically', () => {
    const critical = scoreFactor({ severity: 'CRITICAL', materiality: 0, confidence: 'LOW' });
    const attentionMaterial = scoreFactor({ severity: 'ATTENTION', materiality: 1, confidence: 'HIGH' });
    expect(critical).toBeGreaterThan(attentionMaterial);
  });
});
