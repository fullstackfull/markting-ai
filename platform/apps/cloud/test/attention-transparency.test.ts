import { describe, it, expect } from 'vitest';
import { buildOpportunityCenter, materialityBreakdown } from '@/lib/markting/intelligence/opportunity-center';
import { buildPortfolio } from '@/lib/markting/orchestrator/sections';

const PERIOD = { current: { start: '2026-09-01', end: '2026-09-30' }, previous: { start: '2026-08-01', end: '2026-08-31' } };

// Minimal AccountIntelligence shape (mirrors test/phase2-redteam-fixes.test.ts) — enough to exercise
// the attention-queue ranking without the full analyze path (which is out of scope / do-not-touch).
function intelWith(diags: Array<{ trust: 'PLATFORM_REPORTED' | 'SYNTHETIC'; conf: 'HIGH' | 'LOW'; id: string }>) {
  const accountDiagnoses = diags.map((d) => ({
    type: 'CPA_DETERIORATION' as const,
    scope: { organizationId: 'o', accountId: 'a', entityId: d.id, entityLevel: 'account' as const },
    severity: 'ATTENTION' as const, summary: { en: 'x', ar: 'x' }, evidence: [], confidence: d.conf, dataTrust: d.trust,
  }));
  return { organizationId: 'o', dataset: 'LIVE', period: PERIOD, mixedCurrency: false, trustTier: 'PLATFORM_REPORTED', windowComplete: true, accountDiagnoses, contribution: [], health: {} as never, crossCampaign: {} as never, campaigns: [], recommendations: [] } as never;
}

describe('B25 — materialityBreakdown is transparent (factors reconstruct the score)', () => {
  it('the severity + spend-share contributions sum to the total', () => {
    const b = materialityBreakdown('ATTENTION', 50, 'HIGH', 'PLATFORM_REPORTED');
    const positive = b.factors.filter((f) => f.key === 'severity' || f.key === 'spend_share').reduce((a, f) => a + f.contribution, 0);
    expect(Math.round(positive * 10) / 10).toBe(Math.round(b.total * 10) / 10);
  });

  it('a LOW-confidence SYNTHETIC item reports explicit discount factors and a lower total', () => {
    const trustworthy = materialityBreakdown('ATTENTION', 50, 'HIGH', 'PLATFORM_REPORTED');
    const shaky = materialityBreakdown('ATTENTION', 50, 'LOW', 'SYNTHETIC');
    expect(shaky.total).toBeLessThan(trustworthy.total);
    expect(shaky.factors.some((f) => f.key === 'confidence')).toBe(true);
    expect(shaky.factors.some((f) => f.key === 'data_trust')).toBe(true);
    // Discount factors are reported as the points they removed (negative contributions).
    expect(shaky.factors.find((f) => f.key === 'data_trust')!.contribution).toBeLessThan(0);
  });
});

describe('B25 — the attention queue exposes WHY each item ranks, deterministically', () => {
  it('every ranked attention item carries its reason factors', () => {
    const oc = buildOpportunityCenter(intelWith([{ trust: 'PLATFORM_REPORTED', conf: 'HIGH', id: 'e1' }]));
    expect(oc.needsAttention.length).toBeGreaterThan(0);
    for (const item of oc.needsAttention) {
      expect(item.factors.length).toBeGreaterThan(0);
      expect(item.factors.some((f) => f.key === 'severity')).toBe(true);
    }
  });

  it('ordering is deterministic: trustworthy outranks SYNTHETIC/low-confidence, with a stable tie-break', () => {
    const a = buildOpportunityCenter(intelWith([
      { trust: 'SYNTHETIC', conf: 'LOW', id: 'zzz' },
      { trust: 'PLATFORM_REPORTED', conf: 'HIGH', id: 'aaa' },
    ]));
    expect(a.needsAttention[0]!.entityId).toBe('aaa');
    expect(a.needsAttention[0]!.materiality).toBeGreaterThan(a.needsAttention[1]!.materiality);

    // Equal materiality → stable tie-break on entityId (never arbitrary).
    const tie = buildOpportunityCenter(intelWith([
      { trust: 'PLATFORM_REPORTED', conf: 'HIGH', id: 'ggg' },
      { trust: 'PLATFORM_REPORTED', conf: 'HIGH', id: 'bbb' },
    ]));
    expect(tie.needsAttention.map((i) => i.entityId)).toEqual(['bbb', 'ggg']);
  });
});

describe('B25 — the portfolio attention queue explains its ranking', () => {
  it('each client row carries factors whose contributions sum to the attention score', () => {
    const section = buildPortfolio();
    expect(section.rows.length).toBeGreaterThan(0);
    for (const row of section.rows) {
      const sum = row.factors.reduce((a, f) => a + f.contribution, 0);
      expect(row.attentionScore).toBe(sum);
      // reasons are derived from the factors, so they stay in lock-step.
      expect(row.reasons.length).toBe(row.factors.length);
    }
  });

  it('is ordered by attention score descending (deterministic)', () => {
    const scores = buildPortfolio().rows.map((r) => r.attentionScore);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});
