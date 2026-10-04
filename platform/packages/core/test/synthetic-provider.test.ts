import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createContext } from '../src/context.js';
import { SyntheticProvider, syntheticSeed, syntheticTools, type SyntheticStateStore } from '../src/testing/synthetic-provider.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'adport-synthetic-test-'));
  vi.stubEnv('ADPORT_HOME', home);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Synthetic provider must never access the network'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(home, { recursive: true, force: true }); });

function fixture() {
  let state = syntheticSeed();
  const store: SyntheticStateStore = {
    async load() { return structuredClone(state); },
    async save(expected, next) {
      if (JSON.stringify(expected) !== JSON.stringify(state)) throw new Error('Concurrent state change');
      state = structuredClone(next);
    },
  };
  return { store, provider: new SyntheticProvider(store) };
}
const args = { account_id: 'demo-eur', campaign_id: 'demo-search', expected_daily_budget_micros: 25_000_000, daily_budget_micros: 27_000_000 };
const query = { level: 'campaign' as const, metrics: ['spend', 'conversions', 'roas'] as const, dateRange: 'last_7_days' as const };

it('uses the real policy gate, persists across runtimes, and never changes historical reports', async () => {
  const { store, provider } = fixture();
  const runtime = await createContext({ providerModules: [{ provider, tools: syntheticTools(provider) }] });
  const before = await provider.report({ ...query, metrics: [...query.metrics] });
  const preview = await runtime.registry.call('demo_set_budget', args, runtime.ctx) as { pending_operation_id: string; applied: boolean };
  expect(preview.applied).toBe(false);
  expect(preview).toMatchObject({ preview: { budgetDeltas: [
    { target: 'Daily budget', currency: 'EUR', fromMicros: 25_000_000, toMicros: 27_000_000 },
  ] } });
  expect((await provider.listCampaigns('demo-eur'))[0]?.dailyBudgetMicros).toBe(25_000_000);
  await expect(runtime.registry.call('demo_set_budget', { ...args, daily_budget_micros: 28_000_000, pending_operation_id: preview.pending_operation_id }, runtime.ctx)).rejects.toMatchObject({ code: 'PENDING_MISMATCH' });
  const result = await runtime.registry.call('demo_set_budget', { ...args, pending_operation_id: preview.pending_operation_id }, runtime.ctx);
  expect(result).toMatchObject({ applied: true });
  const reloaded = new SyntheticProvider(store);
  expect((await reloaded.listCampaigns('demo-eur'))[0]).toMatchObject({ dailyBudgetMicros: 27_000_000, status: 'PAUSED' });
  expect(await reloaded.report({ ...query, metrics: [...query.metrics] })).toEqual(before);
  // Re-applying a completed operation is an idempotent no-op (R0-01): it returns the stored result
  // and does NOT mutate the account a second time.
  const replay = await runtime.registry.call('demo_set_budget', { ...args, pending_operation_id: preview.pending_operation_id }, runtime.ctx);
  expect(replay).toMatchObject({ applied: true });
  expect((await new SyntheticProvider(store).listCampaigns('demo-eur'))[0]?.dailyBudgetMicros).toBe(27_000_000);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects foreign accounts, cross-account campaigns, activation, stale budgets and excessive deltas', async () => {
  const { provider } = fixture();
  const runtime = await createContext({ providerModules: [{ provider, tools: syntheticTools(provider) }] });
  await expect(provider.listCampaigns('real-account')).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  await expect(runtime.registry.call('demo_set_budget', { ...args, account_id: 'demo-usd' }, runtime.ctx)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(runtime.registry.call('demo_set_campaign_status', { status: 'ENABLED' }, runtime.ctx)).rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
  await expect(runtime.registry.call('demo_set_budget', { ...args, expected_daily_budget_micros: 1 }, runtime.ctx)).rejects.toMatchObject({ code: 'PENDING_MISMATCH' });
  await expect(runtime.registry.call('demo_set_budget', { ...args, daily_budget_micros: 100_000_000 }, runtime.ctx)).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  expect(fetch).not.toHaveBeenCalled();
});

it('produces a persisted evidence-backed CPA finding while all campaigns remain paused', async () => {
  const { provider } = fixture();
  const { ctx, registry } = await createContext({ providerModules: [{ provider, tools: syntheticTools(provider) }] });
  const audit = await registry.call('audit_run', { provider: 'demo', account_ids: ['demo-eur'], date_range: 'last_7_days' }, ctx) as { findings: Array<{ id: string }> };
  expect(audit.findings).toHaveLength(1);
  expect(audit.findings[0]).toMatchObject({
    ruleId: 'cpa-outlier', provider: 'demo', accountId: 'demo-eur', status: 'open',
    entity: { id: 'demo-discovery', status: 'PAUSED' },
    metrics: { spend: 112, conversions: 7, cpa: 16 },
  });
  expect(audit.findings[0]).toHaveProperty('proposedAction', undefined);
  const listed = await registry.call('recommendations_list', { provider: 'demo', status: 'open' }, ctx);
  expect(listed).toMatchObject({ count: 1, findings: [{ id: audit.findings[0]!.id }] });
  await expect(registry.call('recommendation_apply', { finding_id: audit.findings[0]!.id }, ctx)).rejects.toThrow(/human judgment/);
  expect((await provider.listCampaigns('demo-eur')).every(c => c.status === 'PAUSED')).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('honors currency, account grouping, metric selection, range and limits', async () => {
  const { provider } = fixture();
  const campaigns = await provider.report({ ...query, metrics: ['spend'], accountIds: ['demo-eur'] });
  expect(campaigns.rows).toHaveLength(3);
  const account = await provider.report({ ...query, metrics: ['spend'], level: 'account', accountIds: ['demo-eur'] });
  expect(account.rows[0]).toMatchObject({ currency: 'EUR', entity: { level: 'account', id: 'demo-eur' }, metrics: { spend: campaigns.rows.reduce((sum, row) => sum + row.metrics.spend!, 0) } });
  expect(Object.keys(account.rows[0]!.metrics)).toEqual(['spend']);
  const usd = await provider.report({ ...query, metrics: ['spend'], accountIds: ['demo-usd'], dateRange: 'yesterday' });
  expect(usd.rows[0]).toMatchObject({ currency: 'USD', metrics: { spend: 22 } });
  expect((await provider.report({ ...query, metrics: ['spend'], limit: 1 })).truncated).toBe(true);
  // Lower-hierarchy depth (Phase B): ad_group/ad levels synthesize parent-linked children with the
  // provider-native entity type preserved — no longer rejected.
  const groups = await provider.report({ ...query, metrics: ['spend'], level: 'ad_group', accountIds: ['demo-eur'] });
  expect(groups.rows.length).toBe(6); // 3 campaigns × 2 ad groups
  expect(groups.rows[0]).toMatchObject({ entity: { level: 'ad_group', parentId: 'demo-search', entityType: 'ad_group' } });
  const ads = await provider.report({ ...query, metrics: ['spend'], level: 'ad', accountIds: ['demo-eur'], limit: 100 });
  expect(ads.rows.length).toBe(12); // 3 campaigns × 2 ad groups × 2 ads
  expect(ads.rows[0]).toMatchObject({ entity: { level: 'ad', parentId: 'demo-search-ag1', entityType: 'ad' } });
});
