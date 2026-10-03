import { describe, expect, it } from 'vitest';
import type { ReportRow } from '@adport/core';
import { normalizeReportRows, type NormalizeContext } from '@/lib/markting/intelligence/normalize';
import { analyzeAndAnswer } from '@/lib/markting/intelligence/service';
import { answerQuestion, classifyQuestion } from '@/lib/markting/intelligence/ask';
import { analyzeAccount } from '@/lib/markting/intelligence/analyze';
import { AiGateway, DEMO_GATEWAY_CONFIG } from '@/lib/markting/ai-gateway';
import { InMemoryUsageLedger } from '@/lib/markting/usage-ledger';
import { emptyBusinessContext, applyConfigured } from '@/lib/markting/business-context';
import type { EngineContext } from '@/lib/markting/engine-context';

const PERIOD = { current: { start: '2026-09-08', end: '2026-09-14' }, previous: { start: '2026-09-01', end: '2026-09-07' } };
function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  return { tier: 'PLATFORM_REPORTED', dateRange: PERIOD.current, windowComplete: true, timezone: 'Asia/Riyadh', readAt: '2026-09-15T00:00:00Z', ...over };
}
function row(id: string, m: Partial<Record<string, number>>, level: ReportRow['entity']['level'] = 'account', name = id): ReportRow {
  return { provider: 'meta', accountId: 'act_1', currency: 'SAR', entity: { level, id, name }, metrics: m as ReportRow['metrics'] };
}
function engineCtx(over: Partial<EngineContext> = {}): EngineContext {
  return { organizationId: 'org-1', userId: 'u-1', requestId: 'req-1', locale: 'en', timezone: 'Asia/Riyadh', mode: 'LIVE_RECOMMENDATIONS', scope: 'recommend', ...over };
}
function analyzeInput() {
  const business = applyConfigured(emptyBusinessContext('org-1'), { targetRoas: 3, reportingCurrency: 'SAR' });
  return {
    engineContext: { organizationId: 'org-1', timezone: 'Asia/Riyadh', locale: 'en' as const },
    dataset: 'LIVE' as const, period: PERIOD,
    currentAccount: normalizeReportRows([row('acc', { spend: 2000, impressions: 200000, clicks: 1000, conversions: 40, conversion_value: 3200 })], ctx()),
    previousAccount: normalizeReportRows([row('acc', { spend: 2000, impressions: 200000, clicks: 2000, conversions: 80, conversion_value: 6400 })], ctx({ dateRange: PERIOD.previous })),
    currentCampaigns: normalizeReportRows([row('c1', { spend: 1500, impressions: 150000, clicks: 700, conversions: 30, conversion_value: 2400 }, 'campaign'), row('c2', { spend: 500, impressions: 50000, clicks: 300, conversions: 10, conversion_value: 800 }, 'campaign')], ctx()),
    previousCampaigns: normalizeReportRows([row('c1', { spend: 1500, impressions: 150000, clicks: 1500, conversions: 70, conversion_value: 5600 }, 'campaign'), row('c2', { spend: 500, impressions: 50000, clicks: 500, conversions: 10, conversion_value: 800 }, 'campaign')], ctx({ dateRange: PERIOD.previous })),
    business, pacing: { plannedBudget: 5000, daysElapsed: 5, daysInPeriod: 7 },
  };
}

describe('production caller (0.3): analyze → gateway → narrated answer', () => {
  it('runs the single path, records free local usage, and persists recommendations via the hook', async () => {
    const ledger = new InMemoryUsageLedger();
    const gateway = new AiGateway(DEMO_GATEWAY_CONFIG, ledger);
    const persisted: string[] = [];
    const out = await analyzeAndAnswer({
      engineContext: engineCtx(), analyze: analyzeInput(), gateway, now: 1_770_000_000_000,
      persist: async (org, recs) => { expect(org).toBe('org-1'); expect(recs.every((r) => r.organizationId === 'org-1')).toBe(true); persisted.push(...recs.map((r) => r.recommendationId)); },
    });
    expect(out.local).toBe(true);
    expect(out.answer.text.length).toBeGreaterThan(0);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ organizationId: 'org-1', status: 'local_fallback', estimatedCostMicros: 0 });
    expect(persisted.length).toBe(out.intelligence.recommendations.length);
  });

  it('is idempotent via the gateway (same request_id does not re-run/charge)', async () => {
    const ledger = new InMemoryUsageLedger();
    const gateway = new AiGateway(DEMO_GATEWAY_CONFIG, ledger);
    await analyzeAndAnswer({ engineContext: engineCtx({ requestId: 'dup' }), analyze: analyzeInput(), gateway, now: 1_770_000_000_000 });
    await expect(analyzeAndAnswer({ engineContext: engineCtx({ requestId: 'dup' }), analyze: analyzeInput(), gateway, now: 1_770_000_000_000 }))
      .rejects.toMatchObject({ code: 'APPLY_IN_PROGRESS' });
    expect(ledger.rows).toHaveLength(1);
  });

  it('answers an "ask" question with evidence from the structured intelligence', async () => {
    const ledger = new InMemoryUsageLedger();
    const gateway = new AiGateway(DEMO_GATEWAY_CONFIG, ledger);
    const out = await analyzeAndAnswer({ engineContext: engineCtx({ requestId: 'q1' }), analyze: analyzeInput(), gateway, question: 'Why did CPA increase?', now: 1_770_000_000_000 });
    expect(out.answer.text.toLowerCase()).toMatch(/cpa|insufficient|evidence/i);
  });
});

describe('ask router (2V)', () => {
  const intel = analyzeAccount(analyzeInput());
  it('classifies the representative questions', () => {
    expect(classifyQuestion('Why did CPA increase?')).toBe('WHY_CPA');
    expect(classifyQuestion('Which campaign hurt ROAS?')).toBe('WHICH_CAMPAIGN_HURT');
    expect(classifyQuestion('Where are we overspending?')).toBe('WHERE_OVERSPENDING');
    expect(classifyQuestion('Do we have enough data to scale?')).toBe('CAN_WE_SCALE');
    expect(classifyQuestion('Compare Google and Meta')).toBe('CHANNEL_COMPARISON');
    expect(classifyQuestion('لماذا ارتفعت تكلفة الاكتساب؟')).toBe('WHY_CPA');
  });
  it('cites evidence or says insufficient — never an unsupported number', () => {
    const a = answerQuestion(intel, 'Why did CPA increase?', 'en');
    expect(a.intent).toBe('WHY_CPA');
    // Either it has backing evidence, or it explicitly defers for insufficiency.
    expect(a.evidence.length > 0 || /insufficient|evidence/i.test(a.text)).toBe(true);
  });
  it('answers in Arabic when asked', () => {
    const a = answerQuestion(intel, 'ما الذي تغيّر هذا الأسبوع؟', 'ar');
    expect(a.text.length).toBeGreaterThan(0);
  });
});
