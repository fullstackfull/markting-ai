import { describe, expect, it, vi } from 'vitest';
import { GoogleAdsRestClient, formatGoogleAdsError } from '../src/client.js';
import { GoogleAdsProvider } from '../src/provider.js';

/**
 * Hardening Program 15 — Google Ads contract / replay EDGE CASES (the P0 counterpart to the Meta
 * contract suite).
 *
 * google.test.ts covers the happy-path mutate/search flows. This suite pins the REPORT-parsing
 * contract against the edges a live GAQL integration hits: multi-page search (nextPageToken), missing /
 * null metric fields (cost_micros absent → no NaN, guarded ratios), schema drift (unknown v26 fields and
 * extra resources ignored), and the error envelope (formatGoogleAdsError → PROVIDER_ERROR with field
 * paths + request id). Fixtures are SYNTHETIC but shaped to the documented v25 googleAds:search response
 * (camelCase JSON, costMicros as micros, nextPageToken). A live-captured cassette suite remains the
 * outstanding P0 that needs real credentials — this replay suite is the credential-less substitute.
 */
const CREDS = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: 'refresh-token' };
const tokenRoute = { match: (u: string) => u.includes('oauth2.googleapis.com/token'), reply: { access_token: 'access-token', expires_in: 3600 } };

function router(routes: Array<{ match: (url: string, body: string) => boolean; reply: unknown; status?: number }>) {
  const calls: Array<{ url: string; body: string }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
    calls.push({ url: u, body });
    const r = routes.find((x) => x.match(u, body));
    if (!r) throw new Error(`Unmatched fetch: ${u}\n${body}`);
    return new Response(JSON.stringify(r.reply), { status: r.status ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const query = {
  accountIds: ['1234567890'],
  level: 'campaign' as const,
  metrics: ['spend', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpa', 'cpm'] as const,
  dateRange: { start: '2026-09-01', end: '2026-09-07' },
};
const provider = (impl: typeof fetch) => new GoogleAdsProvider(new GoogleAdsRestClient(CREDS, 'v25', impl));

describe('Google contract — pagination (follows nextPageToken across pages)', () => {
  it('concatenates rows across two search pages', async () => {
    const page1 = { results: [{ campaign: { id: '11', name: 'A', status: 'ENABLED' }, metrics: { costMicros: '100000000', clicks: '50', impressions: '1000', conversions: '10', conversionsValue: '400' } }], nextPageToken: 'tok-2' };
    const page2 = { results: [{ campaign: { id: '22', name: 'B', status: 'ENABLED' }, metrics: { costMicros: '200000000', clicks: '40', impressions: '2000', conversions: '20', conversionsValue: '900' } }] };
    const { impl } = router([
      tokenRoute,
      { match: (u, b) => u.includes('googleAds:search') && b.includes('tok-2'), reply: page2 },
      { match: (u) => u.includes('googleAds:search'), reply: page1 },
    ]);
    const report = await provider(impl).report({ ...query, metrics: [...query.metrics] });
    expect(report.rows.map((r) => r.entity.id)).toEqual(['11', '22']);
    expect(report.rows[0]!.metrics.spend).toBe(100); // 100_000_000 micros
    expect(report.rows[1]!.metrics.roas).toBe(4.5); // 900 / 200
  });
});

describe('Google contract — missing / null metric fields never produce NaN', () => {
  it('handles a row with no cost, clicks or conversions', async () => {
    const reply = { results: [{ campaign: { id: '11', name: 'Sparse', status: 'PAUSED' }, metrics: { impressions: '500' } }] };
    const { impl } = router([tokenRoute, { match: (u) => u.includes('googleAds:search'), reply }]);
    const report = await provider(impl).report({ ...query, metrics: [...query.metrics] });
    const m = report.rows[0]!.metrics;
    for (const v of Object.values(m)) expect(Number.isFinite(v as number)).toBe(true);
    expect(m.spend).toBe(0);
    expect(m.ctr).toBe(0); // 0 clicks / 500 impressions
    expect(m.cpa).toBe(0); // 0 conversions → guarded, not Infinity/NaN
    expect(m.roas).toBe(0); // 0 spend → guarded
  });
});

describe('Google contract — schema drift (unknown fields ignored)', () => {
  it('ignores unknown v26 fields and unselected resources without crashing', async () => {
    const reply = { results: [{ campaign: { id: '11', name: 'Drift', status: 'ENABLED' }, metrics: { costMicros: '50000000', clicks: '10', impressions: '1000', conversions: '5', conversionsValue: '250' }, someNewV26Field: { nested: true }, adGroup: { id: '99' } }], fieldMask: 'campaign.id,metrics.costMicros' };
    const { impl } = router([tokenRoute, { match: (u) => u.includes('googleAds:search'), reply }]);
    const report = await provider(impl).report({ ...query, metrics: [...query.metrics] });
    expect(report.rows[0]!.entity.name).toBe('Drift');
    expect(report.rows[0]!.metrics.conversions).toBe(5);
    expect(report.rows[0]!.metrics.roas).toBe(5); // 250 / 50
  });
});

describe('Google contract — provider error envelope', () => {
  it('maps an error body through formatGoogleAdsError and throws PROVIDER_ERROR', async () => {
    const errorBody = { error: { message: 'Request contains an invalid argument.', details: [{ requestId: 'req-abc', errors: [{ message: 'Unrecognized field in the query.', location: { fieldPathElements: [{ fieldName: 'query' }] } }] }] } };
    const { impl } = router([tokenRoute, { match: (u) => u.includes('googleAds:search'), reply: errorBody, status: 400 }]);
    await expect(provider(impl).report({ ...query, metrics: [...query.metrics] })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    const formatted = formatGoogleAdsError(400, JSON.stringify(errorBody));
    expect(formatted).toContain('Unrecognized field in the query.');
    expect(formatted).toContain('at query:');
    expect(formatted).toContain('request-id: req-abc');
  });
});
