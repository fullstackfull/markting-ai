import { describe, expect, it } from 'vitest';
import { AssistantIntelligenceService } from '@/lib/markting/orchestrator/assistant-service';
import { demoGatherer } from '@/lib/markting/orchestrator/demo-gatherer';
import { BENCHMARK } from '@/lib/markting/orchestrator/benchmark';
import type { IntelligenceRequestContext } from '@/lib/markting/orchestrator/context';

const ctx: IntelligenceRequestContext = {
  organizationId: 'org-1', userId: 'u-1', permissions: ['owner'],
  accountId: 'sandbox:acc:ramadan', provider: 'sandbox', runtimeMode: 'DEMO',
  reportingCurrency: 'SAR', locale: 'en',
};

describe('Program 29 — executable 50-question media-buyer benchmark (>=40 ANSWERABLE_NOW)', () => {
  it('reaches the target on real orchestrator computations over seeded data', async () => {
    const svc = new AssistantIntelligenceService(demoGatherer);
    const verdicts: Array<{ n: number; answerable: boolean; via: string; detail: string }> = [];

    for (const bq of BENCHMARK) {
      let answerable = false;
      let detail = bq.note;
      if (bq.via === 'surface') {
        answerable = true;
      } else if (bq.via === 'assistant') {
        const a = await svc.ask(ctx, bq.ask ?? bq.q);
        answerable = bq.check ? bq.check(a) : true;
        detail = `intent=${a.intent} section=${a.section?.kind ?? 'none'}${answerable ? '' : ' (CHECK FAILED)'}`;
      } else {
        answerable = false; // agent-only / none
      }
      verdicts.push({ n: bq.n, answerable, via: bq.via, detail });
    }

    const answerable = verdicts.filter((v) => v.answerable);
    const failedAssistant = verdicts.filter((v) => v.via === 'assistant' && !v.answerable);

    // Print a compact report (visible in CI logs).
    // eslint-disable-next-line no-console
    console.log(`BENCHMARK ANSWERABLE_NOW = ${answerable.length}/50`);
    if (failedAssistant.length) {
      // eslint-disable-next-line no-console
      console.log('Assistant checks that did NOT pass:', failedAssistant.map((v) => `#${v.n} ${v.detail}`).join(' | '));
    }

    // No assistant question may silently fail its check (that would be an inflated mapping).
    expect(failedAssistant, failedAssistant.map((v) => `#${v.n}`).join(',')).toEqual([]);
    expect(answerable.length).toBeGreaterThanOrEqual(40);
  });
});
