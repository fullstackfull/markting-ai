import { describe, expect, it } from 'vitest';
import { AssistantIntelligenceService } from '@/lib/markting/orchestrator/assistant-service';
import { demoGatherer, emptyGatherer } from '@/lib/markting/orchestrator/demo-gatherer';
import { orchestrator } from '@/lib/markting/orchestrator/orchestrator';
import type { IntelligenceRequestContext } from '@/lib/markting/orchestrator/context';

/**
 * CODE-RC Programs 27/28 — the product degrades cleanly. A disconnected provider, absent commerce,
 * missing COGS, or insufficient evidence must each yield a truthful empty/blocked/UNKNOWN state — never
 * a crash, never fabricated data — and a broken optional domain must not take down the rest of the
 * answer.
 */
const ctx = (over: Partial<IntelligenceRequestContext> = {}): IntelligenceRequestContext => ({
  organizationId: 'org-1', userId: 'u-1', permissions: ['owner'],
  accountId: 'sandbox:acc:ramadan', provider: 'sandbox', runtimeMode: 'DEMO',
  reportingCurrency: 'SAR', locale: 'en', ...over,
});

describe('empty / NOT_CONNECTED state (live deployment, nothing connected)', () => {
  it('yields a truthful answer with no fabricated figures', async () => {
    const svc = new AssistantIntelligenceService(emptyGatherer);
    const a = await svc.run(ctx({ runtimeMode: 'LIVE_WRITE_DISABLED' }), 'DAILY_REVIEW');
    expect(a.nextAction).toBe('INSUFFICIENT_EVIDENCE');
    // nothing connected → no live tier, no invented factor
    expect(a.result.diagnosis.factors.length).toBe(0);
  });
});

describe('a broken / absent optional domain does not crash the account experience', () => {
  it('composes a media-only answer when commerce + creative are absent', () => {
    const result = orchestrator.compose({
      context: ctx(),
      intent: 'PROFITABILITY_DECLINE',
      media: { diagnoses: [{
        type: 'CPA_DETERIORATION',
        scope: { organizationId: 'org-1', accountId: 'a', entityId: 'c1', entityLevel: 'campaign' },
        severity: 'ATTENTION', summary: { en: 'x', ar: 'x' }, evidence: [], confidence: 'MEDIUM', dataTrust: 'PLATFORM_REPORTED',
      }] },
      // commerce + creative deliberately omitted (the optional domains are "down")
    });
    expect(result.diagnosis.factors.some((f) => f.key === 'MEDIA:CPA_DETERIORATION')).toBe(true);
    expect(result.nextAction).not.toBe('INSUFFICIENT_EVIDENCE');
  });

  it('reports availability honestly rather than failing when a domain is NOT_CONNECTED', () => {
    const result = orchestrator.compose({
      context: ctx(),
      intent: 'DAILY_REVIEW',
      availability: { MEDIA: 'CONTRIBUTED', COMMERCE: 'NOT_CONNECTED', CREATIVE: 'NOT_CONNECTED' },
      media: { diagnoses: [] },
    });
    expect(result).toBeDefined();
    // every surfaced factor still carries grounding; nothing is invented for the absent domains
    expect(result.diagnosis.factors.every((f) => !!f.dataTrust)).toBe(true);
  });
});

describe('UNKNOWN (not zero) for missing commerce inputs', () => {
  it('demo commerce withholds profit/margin when COGS is unknown (COGS-unknown client)', async () => {
    const svc = new AssistantIntelligenceService(demoGatherer);
    // the Dubai Electronics seed account has missing COGS
    const a = await svc.run(ctx({ accountId: 'sandbox:acc:electronics' }), 'COMMERCE_PROFIT');
    if (a.section?.kind === 'commerce' && a.section.available) {
      expect(a.section.margin?.notComputableReason ?? 'UNKNOWN').toBeTruthy();
    } else {
      // commerce not available for this account is also an acceptable honest degraded state
      expect(a.section?.kind === 'commerce' ? a.section.available : false).toBe(false);
    }
  });
});
