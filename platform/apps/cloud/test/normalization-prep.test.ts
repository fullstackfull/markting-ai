import { describe, expect, it } from 'vitest';
import {
  META_INSIGHTS_CONTRACT,
  META_CONVERSION_ACTION_TYPE,
  classifyMetaInsightRow,
  normalizeMetaInsightRow,
  type MetaInsightRaw,
} from '@/lib/markting/ops/meta-normalization-prep';
import {
  GOOGLE_SEARCH_CONTRACT,
  MICROS_PER_UNIT,
  classifyGoogleSearchRow,
  normalizeGoogleSearchRow,
  type GoogleSearchRaw,
} from '@/lib/markting/ops/google-normalization-prep';
import { detectSchemaDrift } from '@/lib/markting/ops/schema-drift';
import { normalizeReportRow } from '@/lib/markting/intelligence/normalize';

/**
 * PHASE C.6 (items 7,8) — META / GOOGLE NORMALIZATION PREP.
 *
 * DOCUMENTATION_DERIVED field maps + pure normalizers validated against FAKE sample payloads only. No
 * credentials, no network, no live verification. The canonical rows produced here are then fed to the
 * real `normalizeReportRow` to prove they fit the existing canonical pipeline.
 */

// ---- FAKE sample payloads (documented shapes; NOT live-captured) ----

const FAKE_META_ROW: MetaInsightRaw = {
  account_id: 'act_123',
  campaign_id: 'c1',
  campaign_name: 'Prospecting',
  spend: '123.45',
  impressions: '10000',
  clicks: '250',
  actions: [
    { action_type: 'link_click', value: '240' },
    { action_type: META_CONVERSION_ACTION_TYPE, value: '12' },
  ],
  action_values: [{ action_type: META_CONVERSION_ACTION_TYPE, value: '678.90' }],
  date_start: '2026-01-01',
  date_stop: '2026-01-07',
};

const FAKE_GOOGLE_ROW: GoogleSearchRaw = {
  customer: { id: '1234567890', currencyCode: 'USD' },
  campaign: { id: 'g1', name: 'Search Brand', status: 'ENABLED' },
  metrics: {
    costMicros: '45000000', // 45.00 units
    impressions: '8000',
    clicks: '400',
    conversions: 20,
    conversionsValue: 1500.5,
  },
  segments: { date: '2026-01-01' },
};

describe('C.6/7 — Meta Insights normalization prep', () => {
  it('maps a documented row to canonical metric keys', () => {
    const res = normalizeMetaInsightRow(FAKE_META_ROW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.provider).toBe('meta');
    expect(res.row.entity.level).toBe('campaign');
    expect(res.row.metrics).toMatchObject({
      spend: 123.45,
      impressions: 10000,
      clicks: 250,
      conversions: 12,
      conversion_value: 678.9,
    });
  });

  it('never infers currency (left unset — no FX guess)', () => {
    const res = normalizeMetaInsightRow(FAKE_META_ROW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.currency).toBeUndefined();
  });

  it('carries through ONLY the documented omni_purchase attribution; fabricates none', () => {
    const noConv: MetaInsightRaw = { ...FAKE_META_ROW, actions: [{ action_type: 'link_click', value: '5' }], action_values: [] };
    const res = normalizeMetaInsightRow(noConv);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.metrics.conversions).toBeUndefined();
    expect(res.row.metrics.conversion_value).toBeUndefined();
  });

  it('rejects a row with no entity identity and one with no base metrics', () => {
    expect(normalizeMetaInsightRow({ spend: '10' } as MetaInsightRaw).ok).toBe(false);
    expect(normalizeMetaInsightRow({ campaign_id: 'c1' }).ok).toBe(false);
  });

  it('resolves entity level from the deepest id present', () => {
    const adRow: MetaInsightRaw = { account_id: 'act_1', campaign_id: 'c', adset_id: 's', ad_id: 'a', ad_name: 'Ad', impressions: '1' };
    const res = normalizeMetaInsightRow(adRow);
    expect(res.ok && res.row.entity.level).toBe('ad');
    if (res.ok) expect(res.row.entity.parentId).toBe('s');
  });

  it('the produced canonical row is consumable by the existing normalizeReportRow', () => {
    const res = normalizeMetaInsightRow(FAKE_META_ROW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const obs = normalizeReportRow(res.row, {
      tier: 'SYNTHETIC',
      dateRange: { start: '2026-01-01', end: '2026-01-07' },
      windowComplete: true,
      readAt: '2026-01-08T00:00:00.000Z',
    });
    expect(obs.provider).toBe('meta');
    expect(obs.metrics.spend).toBe(123.45);
    expect(obs.metrics.conversions).toBe(12);
    expect(obs.trust.tier).toBe('SYNTHETIC');
  });
});

describe('C.6/7 — Meta classifier + drift contract', () => {
  it('the fake sample has no schema drift against the documented contract', () => {
    const report = detectSchemaDrift(META_INSIGHTS_CONTRACT, FAKE_META_ROW);
    expect(report.status).toBe('NONE');
    expect(report.signal).toBeNull();
  });

  it('a shape-broken sample is flagged SCHEMA by the classifier', () => {
    const broken = { ...FAKE_META_ROW, impressions: 10000 } as unknown as MetaInsightRaw; // number, not string
    const drift = detectSchemaDrift(META_INSIGHTS_CONTRACT, broken);
    expect(drift.status).toBe('BREAKING');
    expect(classifyMetaInsightRow(broken, drift.status === 'BREAKING')).toBe('SCHEMA');
  });

  it('classifier returns ACCEPT for a good row and REJECT for an unusable one', () => {
    expect(classifyMetaInsightRow(FAKE_META_ROW, false)).toBe('ACCEPT');
    expect(classifyMetaInsightRow({ campaign_id: 'c1' }, false)).toBe('REJECT');
  });
});

describe('C.6/8 — Google Ads normalization prep', () => {
  it('maps a documented GAQL row to canonical metric keys', () => {
    const res = normalizeGoogleSearchRow(FAKE_GOOGLE_ROW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.provider).toBe('google');
    expect(res.row.metrics).toMatchObject({ impressions: 8000, clicks: 400, conversions: 20, conversion_value: 1500.5 });
  });

  it('converts cost_micros -> currency units (same-currency unit conversion, not FX)', () => {
    const res = normalizeGoogleSearchRow(FAKE_GOOGLE_ROW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row.metrics.spend).toBe(45000000 / MICROS_PER_UNIT);
    expect(res.row.metrics.spend).toBe(45);
  });

  it('carries currency only from the documented customer.currencyCode; never guesses', () => {
    const res = normalizeGoogleSearchRow(FAKE_GOOGLE_ROW);
    expect(res.ok && res.row.currency).toBe('USD');
    const noCurrency: GoogleSearchRaw = { ...FAKE_GOOGLE_ROW, customer: { id: '1234567890' } };
    const res2 = normalizeGoogleSearchRow(noCurrency);
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.row.currency).toBeUndefined();
  });

  it('rejects a row with no entity identity / no base metrics', () => {
    expect(normalizeGoogleSearchRow({ metrics: { costMicros: '1' } }).ok).toBe(false);
    expect(normalizeGoogleSearchRow({ campaign: { id: 'g1' } }).ok).toBe(false);
  });

  it('the produced canonical row is consumable by the existing normalizeReportRow (currency carried)', () => {
    const res = normalizeGoogleSearchRow(FAKE_GOOGLE_ROW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const obs = normalizeReportRow(res.row, {
      tier: 'SYNTHETIC',
      dateRange: { start: '2026-01-01', end: '2026-01-01' },
      windowComplete: true,
      readAt: '2026-01-02T00:00:00.000Z',
    });
    expect(obs.currency).toBe('USD');
    expect(obs.metrics.spend).toBe(45);
  });
});

describe('C.6/8 — Google classifier + drift contract', () => {
  it('the fake sample has no schema drift against the documented contract', () => {
    const report = detectSchemaDrift(GOOGLE_SEARCH_CONTRACT, FAKE_GOOGLE_ROW);
    expect(report.status).toBe('NONE');
  });

  it('a shape-broken sample is flagged SCHEMA by the classifier', () => {
    const broken: GoogleSearchRaw = { ...FAKE_GOOGLE_ROW, metrics: { ...FAKE_GOOGLE_ROW.metrics, costMicros: 45 as unknown as string } };
    const drift = detectSchemaDrift(GOOGLE_SEARCH_CONTRACT, broken);
    expect(drift.status).toBe('BREAKING');
    expect(classifyGoogleSearchRow(broken, true)).toBe('SCHEMA');
  });

  it('classifier returns ACCEPT / REJECT appropriately', () => {
    expect(classifyGoogleSearchRow(FAKE_GOOGLE_ROW, false)).toBe('ACCEPT');
    expect(classifyGoogleSearchRow({ campaign: { id: 'g1' } }, false)).toBe('REJECT');
  });
});
