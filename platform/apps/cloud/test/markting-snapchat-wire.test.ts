/**
 * Snapchat through the bridge, end to end on the wire: a synthetic engine proposal for `snap_ads`
 * becomes an adport `snapchat_*` guarded write, previews with no mutation request, and applies
 * exactly one JSON Patch to the Snap Marketing API v1. The HTTP layer is a fixture (official
 * envelope shapes, synthetic ids); nothing contacts Snapchat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContext, DEFAULT_POLICY, PolicyEngine, type AuditEntry, type PendingOperation } from '@adport/core';
import { SnapchatAdsClient, SnapchatAdsProvider, snapchatTools, SNAPCHAT_TOKEN_URL } from '@adport/provider-snapchat';
import { applyPending, bridgeProposal, type BridgeRecord } from '@/lib/markting/bridge';
import type { AliasMap } from '@/lib/markting/translate';
import { syntheticProposal } from './fixtures/engine-proposal';

const account = { id: 'snap-acct-1', name: 'Demo Snap account', currency: 'USD', timezone: 'Asia/Riyadh', status: 'ACTIVE' };
const campaign = { id: 'snap-camp-1', name: 'Ramadan Awareness', ad_account_id: account.id, status: 'ACTIVE', daily_budget_micro: 300_000_000 };
function envelope(plural: string, singular: string, rows: unknown[]) {
  return { request_status: 'SUCCESS', request_id: 'request-1', [plural]: rows.map((row) => ({ sub_request_status: 'SUCCESS', [singular]: row })), paging: {} };
}
type Route = { path: string; method?: string; reply: unknown };
function fixture(routes: Route[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === SNAPCHAT_TOKEN_URL) return Response.json({ access_token: 'access', expires_in: 3600, refresh_token: 'refresh' });
    const parsed = new URL(String(url));
    const route = routes.find((r) => parsed.pathname === `/v1/${r.path}` && (r.method ?? 'GET') === (init.method ?? 'GET'));
    if (!route) throw new Error(`Unexpected request: ${init.method ?? 'GET'} ${parsed.pathname}`);
    return Response.json(route.reply);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
class MemoryPending {
  rows = new Map<string, PendingOperation>();
  async put(op: PendingOperation) { this.rows.set(op.id, op); }
  async get(id: string) { return this.rows.get(id); }
  async delete(id: string) { this.rows.delete(id); }
  async sweep() {}
}
class MemoryAudit { entries: Array<Omit<AuditEntry, 'ts'>> = []; async append(entry: Omit<AuditEntry, 'ts'>) { this.entries.push(entry); } }

const ALIASES: AliasMap = { 'acme-snap': { alias: 'acme-snap', provider: 'snapchat', accountId: account.id, currency: 'USD', targets: { 's-401': campaign.id } } };

async function snapRuntime(routes: Route[], policy = DEFAULT_POLICY) {
  const { fetchImpl, calls } = fixture(routes);
  const provider = new SnapchatAdsProvider(new SnapchatAdsClient({ clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh' }, fetchImpl));
  const pending = new MemoryPending();
  const audit = new MemoryAudit();
  const runtime = await createContext({ providerModules: [{ provider, tools: snapchatTools(provider) }], engine: new PolicyEngine(policy, pending, audit) });
  const records: BridgeRecord[] = [];
  const deps = { runtime, aliases: ALIASES, scopes: ['tools:read', 'tools:write'], record: async (r: BridgeRecord) => { records.push(r); }, note: async () => {} };
  return { runtime, calls, pending, audit, records, deps };
}
const patches = (calls: Array<{ url: string; init: RequestInit }>) => calls.filter((c) => c.init.method === 'PATCH');
const campaignRoute = { path: `campaigns/${campaign.id}`, reply: envelope('campaigns', 'campaign', [campaign]) };

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('global fetch must not be used'); })); });

describe('Snapchat: engine proposal → adport preview → JSON Patch on the wire', () => {
  it('previews a budget change by reading the campaign only, then applies one PATCH with the engine value in micros', async () => {
    const { calls, pending, deps, runtime, audit } = await snapRuntime([campaignRoute, { path: `adaccounts/${account.id}/campaigns/${campaign.id}`, method: 'PATCH', reply: envelope('campaigns', 'campaign', [{ ...campaign, daily_budget_micro: 240_000_000 }]) }]);
    const proposal = syntheticProposal({ platform: 'snap_ads', account_ref: 'acme-snap', tool_name: 'snap_ads__update_campaign_budget', target_ref: 's-401', after: [{ field: 'daily_budget', value: 240, unit: 'account currency per day' }] });
    const result = await bridgeProposal(proposal, deps);
    expect(result.outcome).toBe('pending');
    if (result.outcome !== 'pending') throw new Error('unreachable');
    expect(result.translation).toMatchObject({ tool: 'snapchat_set_budget', accountId: account.id, input: { campaign_id: campaign.id, field: 'daily_budget_micro', budget_micros: 240_000_000 } });
    expect(result.preview.preview.budgetDeltas).toEqual([{ target: `campaign ${campaign.id} daily_budget_micro`, fromMicros: 300_000_000, toMicros: 240_000_000 }]);
    expect(result.preview.preview.serverValidated).toBe(false);
    expect(patches(calls)).toHaveLength(0);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/login/oauth2/access_token', `/v1/campaigns/${campaign.id}`]);
    expect(calls[1]!.init.headers).toMatchObject({ authorization: 'Bearer access' });

    const row = pending.rows.get(result.preview.pending_operation_id)!;
    await applyPending(runtime, { id: row.id, operation: row.op as { tool: string; accountId: string; payload: Record<string, unknown> } });
    const patch = patches(calls);
    expect(patch).toHaveLength(1);
    expect(new URL(patch[0]!.url).pathname).toBe(`/v1/adaccounts/${account.id}/campaigns/${campaign.id}`);
    expect(patch[0]!.init.headers).toMatchObject({ 'content-type': 'application/json-patch+json' });
    expect(JSON.parse(String(patch[0]!.init.body))).toEqual([{ op: 'replace', path: '/daily_budget_micro', value: 240_000_000 }]);
    expect(audit.entries.map((entry) => entry.event)).toEqual(['validated', 'applied']);
    expect(pending.rows.size).toBe(0);
  });

  it('maps a status proposal onto Snapchat ACTIVE/PAUSED and patches only /status', async () => {
    const { calls, pending, deps, runtime } = await snapRuntime([campaignRoute, { path: `adaccounts/${account.id}/campaigns/${campaign.id}`, method: 'PATCH', reply: envelope('campaigns', 'campaign', [{ ...campaign, status: 'PAUSED' }]) }]);
    const proposal = syntheticProposal({ platform: 'snap_ads', account_ref: 'acme-snap', tool_name: 'snap_ads__update_campaign_status', target_ref: 's-401', before: [{ field: 'status', value: 'ENABLED' }], after: [{ field: 'status', value: 'PAUSED' }] });
    const result = await bridgeProposal(proposal, deps);
    if (result.outcome !== 'pending') throw new Error(`unexpected ${result.outcome}`);
    expect(result.translation.input).toEqual({ campaign_id: campaign.id, status: 'PAUSED' });
    const row = pending.rows.get(result.preview.pending_operation_id)!;
    await applyPending(runtime, { id: row.id, operation: row.op as { tool: string; accountId: string; payload: Record<string, unknown> } });
    expect(JSON.parse(String(patches(calls)[0]!.init.body))).toEqual([{ op: 'replace', path: '/status', value: 'PAUSED' }]);
  });

  it('refuses the preview when the campaign belongs to another ad account, before any mutation', async () => {
    const { calls, deps, records } = await snapRuntime([{ ...campaignRoute, reply: envelope('campaigns', 'campaign', [{ ...campaign, ad_account_id: 'someone-else' }]) }]);
    const result = await bridgeProposal(syntheticProposal({ platform: 'snap_ads', account_ref: 'acme-snap', tool_name: 'snap_ads__update_campaign_budget', target_ref: 's-401' }), deps);
    expect(result).toMatchObject({ outcome: 'rejected_by_policy', code: 'INVALID_INPUT' });
    expect(patches(calls)).toHaveLength(0);
    expect(records[0]?.status).toBe('rejected_by_policy');
  });

  it('applies the 25% budget-delta cap from the organization policy to Snapchat micros', async () => {
    const { calls, deps } = await snapRuntime([campaignRoute]);
    const result = await bridgeProposal(syntheticProposal({ platform: 'snap_ads', account_ref: 'acme-snap', tool_name: 'snap_ads__update_campaign_budget', target_ref: 's-401', after: [{ field: 'daily_budget', value: 900 }] }), deps);
    expect(result).toMatchObject({ outcome: 'rejected_by_policy', code: 'POLICY_VIOLATION' });
    expect(patches(calls)).toHaveLength(0);
  });

  it('never calls Snapchat for an unmapped alias or an unknown engine target', async () => {
    const { calls, deps } = await snapRuntime([]);
    const foreign = await bridgeProposal(syntheticProposal({ platform: 'snap_ads', account_ref: 'not-mapped', tool_name: 'snap_ads__update_campaign_budget' }), deps);
    expect(foreign.outcome).toBe('unsupported');
    const unknownTarget = await bridgeProposal(syntheticProposal({ platform: 'snap_ads', account_ref: 'acme-snap', tool_name: 'snap_ads__update_campaign_budget', target_ref: 's-999' }), { ...deps, runtime: deps.runtime });
    // s-999 is not in the target map, so it is passed through verbatim and the provider rejects it at read time.
    expect(unknownTarget.outcome).toBe('rejected_by_policy');
    expect(patches(calls)).toHaveLength(0);
  });
});
