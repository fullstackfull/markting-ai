import { describe, expect, it } from 'vitest';
import { SandboxProvider, InMemorySandboxStore, SANDBOX_PROVIDER_ID } from '@/lib/markting/sandbox-provider';

/**
 * PHASE B (B2/B30) — the sandbox provider (the credential-free DEMO/CI report path) emits parent-linked
 * ad_group + ad rows with the provider-native entity type preserved, so lower-hierarchy depth is
 * exercisable end-to-end without live credentials. Clearly SYNTHETIC — no real spend.
 */
const METRICS = ['spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'roas'] as const;
function provider() {
  return new SandboxProvider(new InMemorySandboxStore());
}
const query = { metrics: [...METRICS], dateRange: 'last_7_days' as const, level: 'campaign' as const };

describe('sandbox provider lower-hierarchy', () => {
  it('still reports account + campaign levels (unchanged)', async () => {
    const acc = await provider().report({ ...query, level: 'account', accountIds: ['fixture-meta-0001'] });
    expect(acc.rows.every((r) => r.entity.level === 'account')).toBe(true);
    const camp = await provider().report({ ...query, level: 'campaign', accountIds: ['fixture-meta-0001'] });
    expect(camp.rows.length).toBeGreaterThan(0);
    expect(camp.rows.every((r) => r.entity.level === 'campaign')).toBe(true);
  });

  it('emits ad_group rows linked to their campaign with the provider-native type (Meta = adset)', async () => {
    const groups = await provider().report({ ...query, level: 'ad_group', accountIds: ['fixture-meta-0001'], limit: 500 });
    expect(groups.rows.length).toBeGreaterThan(0);
    for (const r of groups.rows) {
      expect(r.entity.level).toBe('ad_group');
      expect(r.entity.parentId).toBeTruthy();
      expect(r.entity.entityType).toBe('adset'); // Meta native term
      expect(r.provider).toBe(SANDBOX_PROVIDER_ID);
    }
    // Google account uses the 'ad_group' native term, not 'adset'.
    const g = await provider().report({ ...query, level: 'ad_group', accountIds: ['fixture-google-0001'], limit: 500 });
    expect(g.rows.every((r) => r.entity.entityType === 'ad_group')).toBe(true);
  });

  it('emits ad rows linked to their ad_group (parentId chains correctly)', async () => {
    const ads = await provider().report({ ...query, level: 'ad', accountIds: ['fixture-meta-0001'], limit: 1000 });
    const groups = await provider().report({ ...query, level: 'ad_group', accountIds: ['fixture-meta-0001'], limit: 1000 });
    const groupIds = new Set(groups.rows.map((r) => r.entity.id));
    expect(ads.rows.length).toBeGreaterThan(0);
    for (const r of ads.rows) {
      expect(r.entity.level).toBe('ad');
      expect(groupIds.has(r.entity.parentId!), `ad ${r.entity.id} parent ${r.entity.parentId} is a known ad_group`).toBe(true);
    }
  });

  it('projects only the requested metrics with finite values', async () => {
    const groups = await provider().report({ metrics: ['spend', 'roas'], dateRange: 'last_7_days', level: 'ad_group', accountIds: ['fixture-meta-0001'] });
    for (const r of groups.rows) {
      expect(Object.keys(r.metrics).sort()).toEqual(['roas', 'spend']);
      expect(Number.isFinite(r.metrics.spend!)).toBe(true);
    }
  });
});
