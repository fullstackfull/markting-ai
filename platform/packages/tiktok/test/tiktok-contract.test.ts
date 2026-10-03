import { describe, expect, it, vi } from 'vitest';
import { TikTokClient } from '../src/client.js';
import { TikTokAdsProvider } from '../src/provider.js';

/**
 * CODE-RC Programs 22/23 — TikTok report contract / replay + normalization fuzz.
 *
 * Fixtures are DOCUMENTATION_DERIVED (TikTok Business API v1.3 `report/integrated/get`: string metric
 * values, errors as HTTP 200 with non-zero `code`) and SYNTHETIC — never LIVE_CAPTURED. The suite pins
 * the normalization contract against the edges a live integration hits: missing/zero/huge metric values
 * (no NaN/Infinity, no implicit zero for an UNKNOWN), unknown/extra fields ignored, and the error
 * envelope. A live-captured cassette remains the external go-live task.
 */
function fakeFetch(reply: unknown, status = 200) {
  const impl = vi.fn(async () => new Response(JSON.stringify(reply), { status }));
  return impl as unknown as typeof fetch;
}
const CREDS = { accessToken: 'tt-access-token', appId: 'app-1', secret: 'secret-1' };
const provider = (reply: unknown, status = 200) => new TikTokAdsProvider(new TikTokClient(CREDS, fakeFetch(reply, status)));
const query = {
  accountIds: ['7000000001'],
  level: 'campaign' as const,
  metrics: ['spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'roas', 'ctr', 'cpa', 'cpm'] as const,
  dateRange: { start: '2026-09-01', end: '2026-09-07' },
};
const report = (reply: unknown, status = 200) => provider(reply, status).report({ ...query, metrics: [...query.metrics] });
const ok = (list: unknown[]) => ({ code: 0, message: 'OK', request_id: 'r1', data: { list } });

describe('TikTok contract — documented happy shape', () => {
  it('normalizes string metrics and derives guarded ratios', async () => {
    const r = await report(ok([{ dimensions: { campaign_id: 'c1' }, metrics: { campaign_name: 'A', spend: '100.00', impressions: '1000', clicks: '50', conversion: '10', total_complete_payment_rate: '400' } }]));
    expect(r.rows[0]!.entity.id).toBe('c1');
    expect(r.rows[0]!.entity.name).toBe('A');
    expect(r.rows[0]!.metrics.roas).toBe(4); // 400 / 100
    expect(r.rows[0]!.metrics.ctr).toBe(5); // 50 / 1000 * 100
  });
});

describe('TikTok normalization fuzz — never NaN/Infinity, no implicit-zero for unknown', () => {
  it('missing metrics → finite, guarded ratios (0 denom → 0, not NaN/Infinity)', async () => {
    const r = await report(ok([{ dimensions: { campaign_id: 'c1' }, metrics: { campaign_name: 'Sparse' } }]));
    const m = r.rows[0]!.metrics;
    for (const v of Object.values(m)) expect(Number.isFinite(v as number)).toBe(true);
    expect(m.spend).toBe(0);
    expect(m.roas).toBe(0); // 0 spend guarded
    expect(m.cpa).toBe(0); // 0 conversions guarded
  });
  it('huge string values stay finite numbers', async () => {
    const r = await report(ok([{ dimensions: { campaign_id: 'c1' }, metrics: { spend: '999999999.99', impressions: '1000000000', clicks: '0', conversion: '0', total_complete_payment_rate: '0' } }]));
    const m = r.rows[0]!.metrics;
    expect(Number.isFinite(m.spend)).toBe(true);
    expect(m.ctr).toBe(0); // 0 clicks
  });
  it('unknown/extra dimension + metric fields are ignored', async () => {
    const r = await report(ok([{ dimensions: { campaign_id: 'c1', some_new_dim: 'x' }, metrics: { spend: '10', impressions: '100', clicks: '5', conversion: '1', total_complete_payment_rate: '40', brand_new_v2_metric: '123' } }]));
    expect(r.rows[0]!.metrics.roas).toBe(4);
    expect(r.rows).toHaveLength(1);
  });
  it('empty list → no rows (not a crash)', async () => {
    const r = await report(ok([]));
    expect(r.rows).toEqual([]);
  });
});

describe('TikTok contract — error envelope (HTTP 200 code != 0 → PROVIDER_ERROR)', () => {
  it('maps a non-zero code to PROVIDER_ERROR', async () => {
    await expect(report({ code: 40002, message: 'Invalid advertiser_id', request_id: 'r2', data: {} }))
      .rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});
