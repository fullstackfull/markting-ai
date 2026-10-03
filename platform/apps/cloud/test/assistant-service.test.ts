import { describe, expect, it } from 'vitest';
import { AssistantIntelligenceService, routeIntent } from '@/lib/markting/orchestrator/assistant-service';
import { demoGatherer, emptyGatherer } from '@/lib/markting/orchestrator/demo-gatherer';
import type { IntelligenceRequestContext } from '@/lib/markting/orchestrator/context';

const ctx: IntelligenceRequestContext = {
  organizationId: 'org-1', userId: 'u-1', permissions: ['tools:read'],
  accountId: 'sandbox:acc:1', provider: 'sandbox', runtimeMode: 'DEMO',
  reportingCurrency: 'SAR', locale: 'en',
};

describe('Program 3 — question → intent routing (deterministic, bilingual)', () => {
  it('routes profit/refund questions to PROFITABILITY_DECLINE (en + ar)', () => {
    expect(routeIntent('Why did profitability decline and what should I do?')).toBe('PROFITABILITY_DECLINE');
    expect(routeIntent('لماذا انخفضت الربحية وما العمل؟')).toBe('PROFITABILITY_DECLINE');
  });
  it('routes attention/today questions to DAILY_REVIEW; account/campaign to ACCOUNT_DIAGNOSIS', () => {
    expect(routeIntent('what needs my attention today?')).toBe('DAILY_REVIEW');
    expect(routeIntent('diagnose this campaign')).toBe('CAMPAIGN_DIAGNOSIS');
    expect(routeIntent('diagnose this account')).toBe('ACCOUNT_DIAGNOSIS');
    expect(routeIntent('hello')).toBe('DAILY_REVIEW');
  });
});

describe('Program 3 — Assistant answers via the unified orchestration path', () => {
  it('answers "why did profitability decline?" across domains, deterministically, with evidence', async () => {
    const svc = new AssistantIntelligenceService(demoGatherer);
    const a = await svc.ask(ctx, 'Why did profitability decline and what should I do?');
    expect(a.intent).toBe('PROFITABILITY_DECLINE');
    expect(a.source).toBe('DETERMINISTIC_ONLY'); // no model configured — honest, not a fake live model
    expect(a.text.en).toContain('merchant-side');
    expect(a.text.ar.length).toBeGreaterThan(0);
    // Cross-domain evidence is attached and inspectable (no hidden chain-of-thought).
    const domains = new Set(a.evidence.map((e) => e.domain));
    expect(domains.has('COMMERCE')).toBe(true);
    expect(domains.has('MEDIA')).toBe(true);
    expect(domains.has('CREATIVE')).toBe(true);
    // Unified recommendations surfaced, all review-only.
    expect(a.recommendationIds.length).toBeGreaterThanOrEqual(2);
    // Demo data is synthetic → the trust tier is non-live.
    expect(a.trustTier).toBe('SYNTHETIC');
    expect(['REVIEW', 'ATTENTION']).toContain(a.nextAction);
    expect(a.nextBestQuestion?.en).toContain('refund');
  });

  it('gives an honest INSUFFICIENT_EVIDENCE answer when nothing is connected', async () => {
    const svc = new AssistantIntelligenceService(emptyGatherer);
    const a = await svc.run({ ...ctx, runtimeMode: 'LIVE_RECOMMENDATIONS' }, 'DAILY_REVIEW');
    expect(a.nextAction).toBe('INSUFFICIENT_EVIDENCE');
    expect(a.text.en.toLowerCase()).toContain('connect');
    expect(a.recommendationIds).toEqual([]);
  });
});
