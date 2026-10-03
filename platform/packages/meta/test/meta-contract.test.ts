import { createContext } from '@adport/core';
import { describe, expect, it, vi } from 'vitest';
import { MetaGraphClient, formatMetaError } from '../src/client.js';
import { MetaAdsProvider } from '../src/provider.js';

/**
 * Coherence-2 Program 23 — Meta contract / replay EDGE CASES.
 *
 * The existing meta.test.ts covers the happy-path documented shapes. This suite adds the replay edges a
 * live integration hits: multi-page pagination (paging.next), missing/null optional fields, schema
 * drift (unknown fields), and a provider error envelope. Fixtures are SYNTHETIC but shaped to the
 * documented v25.0 Marketing API (string-typed metrics, actions arrays, paging.next). A live-captured
 * cassette suite (and the same for Google) remains the outstanding P0 — see docs/coherence2/07.
 */
const CREDS = { accessToken: 'EAAJB-test-token' };

function router(routes: Array<{ match: (url: string) => boolean; reply: unknown; status?: number }>) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('fields=currency')) return new Response(JSON.stringify({ currency: 'USD' }), { status: 200 });
    const r = routes.find((x) => x.match(u));
    if (!r) throw new Error(`Unmatched fetch: ${u}`);
    return new Response(JSON.stringify(r.reply), { status: r.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const query = { accountIds: ['act_1'], level: 'campaign' as const, metrics: ['spend', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpa', 'cpm'] as const, dateRange: { start: '2026-09-01', end: '2026-09-07' } };

describe('Meta contract — pagination (follows paging.next across pages)', () => {
  it('concatenates rows across two pages', async () => {
    const page1 = { data: [{ campaign_id: 'c1', campaign_name: 'A', spend: '100', impressions: '1000', clicks: '50', actions: [{ action_type: 'omni_purchase', value: '10' }], action_values: [{ action_type: 'omni_purchase', value: '400' }] }], paging: { next: 'https://graph.facebook.com/next-page-token' } };
    const page2 = { data: [{ campaign_id: 'c2', campaign_name: 'B', spend: '200', impressions: '2000', clicks: '40', actions: [{ action_type: 'omni_purchase', value: '20' }], action_values: [{ action_type: 'omni_purchase', value: '900' }] }], paging: {} };
    const { impl } = router([
      { match: (u) => u.includes('next-page-token'), reply: page2 },
      { match: (u) => u.includes('/insights'), reply: page1 },
    ]);
    const provider = new MetaAdsProvider(new MetaGraphClient(CREDS, 'v25.0', impl));
    const report = await provider.report({ ...query, metrics: [...query.metrics] });
    expect(report.rows.map((r) => r.entity.id)).toEqual(['c1', 'c2']);
    expect(report.rows[1]!.metrics.roas).toBe(4.5); // 900/200
  });
});

describe('Meta contract — missing / null optional fields never produce NaN', () => {
  it('handles a row with no actions, no clicks, no action_values', async () => {
    const reply = { data: [{ campaign_id: 'c1', campaign_name: 'Sparse', spend: '150' /* no impressions/clicks/actions */ }], paging: {} };
    const { impl } = router([{ match: (u) => u.includes('/insights'), reply }]);
    const provider = new MetaAdsProvider(new MetaGraphClient(CREDS, 'v25.0', impl));
    const report = await provider.report({ ...query, metrics: [...query.metrics] });
    const m = report.rows[0]!.metrics;
    for (const v of Object.values(m)) expect(Number.isFinite(v as number)).toBe(true);
    expect(m.conversions).toBe(0);
    expect(m.ctr).toBe(0); // 0 impressions → guarded, not NaN
    expect(m.roas).toBe(0);
  });
});

describe('Meta contract — schema drift (unknown fields ignored)', () => {
  it('ignores unknown/extra fields without crashing', async () => {
    const reply = { data: [{ campaign_id: 'c1', campaign_name: 'Drift', spend: '100', impressions: '1000', clicks: '10', actions: [{ action_type: 'omni_purchase', value: '5' }], some_new_v26_field: { nested: true }, cost_per_action_type: [{ action_type: 'x', value: '1' }] }], paging: {}, summary: { total_count: 1 } };
    const { impl } = router([{ match: (u) => u.includes('/insights'), reply }]);
    const provider = new MetaAdsProvider(new MetaGraphClient(CREDS, 'v25.0', impl));
    const report = await provider.report({ ...query, metrics: [...query.metrics] });
    expect(report.rows[0]!.metrics.conversions).toBe(5);
    expect(report.rows[0]!.entity.name).toBe('Drift');
  });
});

describe('Meta contract — provider error envelope', () => {
  it('maps a 500 error body through formatMetaError and throws PROVIDER_ERROR', async () => {
    const errorBody = { error: { message: 'Service temporarily unavailable', type: 'OAuthException', code: 2, fbtrace_id: 'Abc123' } };
    const { impl } = router([{ match: (u) => u.includes('/insights'), reply: errorBody, status: 500 }]);
    const provider = new MetaAdsProvider(new MetaGraphClient(CREDS, 'v25.0', impl));
    await expect(provider.report({ ...query, metrics: [...query.metrics] })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    // formatMetaError surfaces the provider message deterministically.
    expect(formatMetaError(500, JSON.stringify(errorBody))).toContain('Service temporarily unavailable');
  });
});

// A read is read-only by construction: this suite never calls a write tool.
void createContext;
