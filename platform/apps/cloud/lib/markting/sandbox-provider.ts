/**
 * Sandbox provider: a credential-free adport provider that mirrors paid-media-agent's fixture
 * accounts and campaigns, so the Assistant's synthetic proposals land on the same campaigns
 * adport previews. No transport, no credentials, no real spend. Writes go through the normal
 * `guardedWriteTool` → PolicyEngine gate like every other provider.
 *
 * Tool names deliberately avoid the `demo_`/`mock_`/`synthetic_` prefixes that the production
 * MCP connector refuses, because this provider is enabled only by `MARKTING_DEMO_MODE`.
 */
import { z } from 'zod';
import {
  AdportError,
  defineTool,
  guardedWriteTool,
  rangeDayCount,
  resolveDateRange,
  type Account,
  type AdProvider,
  type AnyToolDefinition,
  type MetricName,
  type NormalizedQuery,
  type Report,
  type ReportRow,
  type WriteOperation,
  type WritePreview,
  type WriteResult,
} from '@adport/core';

export const SANDBOX_PROVIDER_ID = 'sandbox';

/** Provider-native lower-hierarchy label per sandbox account, so the demo shows "Ad set" (Meta) vs
 *  "Ad group" (Google) rather than forcing one vocabulary — mirrors the real adapters' semantics. */
const SANDBOX_GROUP_TYPE: Record<string, string> = {
  'fixture-google-0001': 'ad_group',
  'fixture-meta-0001': 'adset',
  'fixture-reddit-0001': 'ad_group',
  'fixture-snap-0001': 'ad_squad',
};

/** Additive base metrics (ratios are derived, never summed). */
type Base = { spend: number; impressions: number; clicks: number; conversions: number; conversion_value: number };
const emptyBase = (): Base => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0 });
const addBase = (a: Base, b: Base): Base => ({ spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, conversions: a.conversions + b.conversions, conversion_value: a.conversion_value + b.conversion_value });
const scaleBase = (b: Base, f: number): Base => ({ spend: b.spend * f, impressions: Math.round(b.impressions * f), clicks: Math.round(b.clicks * f), conversions: Math.round(b.conversions * f), conversion_value: b.conversion_value * f });
/** Deterministic synthetic history for one campaign derived from its seed budget — a budget change
 *  never rewrites the past. Identical formula to the original account/campaign aggregation. */
function campaignBase(campaign: SandboxCampaign, days: number): Base {
  const seedBudget = (sandboxSeed().find((seed) => seed.id === campaign.id)?.dailyBudgetMicros ?? 100_000_000) / 1e6;
  const index = sandboxSeed().findIndex((seed) => seed.id === campaign.id) + 1;
  const spend = seedBudget * 0.82 * days;
  const clicks = Math.round(spend / (1.1 + index * 0.35));
  const conversions = Math.round(clicks * (0.02 + (index % 3) * 0.015));
  return { spend, impressions: clicks * (28 + index * 4), clicks, conversions, conversion_value: conversions * (38 + index * 6) };
}
function withDerived(b: Base): Record<MetricName, number> {
  return {
    ...b,
    ctr: b.impressions ? (b.clicks / b.impressions) * 100 : 0,
    cpc: b.clicks ? b.spend / b.clicks : 0,
    cpm: b.impressions ? (b.spend / b.impressions) * 1000 : 0,
    cpa: b.conversions ? b.spend / b.conversions : 0,
    roas: b.spend ? b.conversion_value / b.spend : 0,
  };
}

export const sandboxCampaignSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  status: z.enum(['ENABLED', 'PAUSED']),
  dailyBudgetMicros: z.number().int().positive().max(1_000_000_000_000),
});
export type SandboxCampaign = z.infer<typeof sandboxCampaignSchema>;
export const sandboxStateSchema = z.array(sandboxCampaignSchema).min(1).max(50);

/** Mirrors engine/config/accounts.example.toml and engine/src/paid_media_agent/fixtures/data/*.json. */
export const SANDBOX_ACCOUNTS: Account[] = [
  { provider: SANDBOX_PROVIDER_ID, id: 'fixture-google-0001', name: 'Demo · Google Ads', currency: 'USD', status: 'ENABLED' },
  { provider: SANDBOX_PROVIDER_ID, id: 'fixture-meta-0001', name: 'Demo · Meta Ads', currency: 'USD', status: 'ENABLED' },
  { provider: SANDBOX_PROVIDER_ID, id: 'fixture-reddit-0001', name: 'Demo · Reddit Ads', currency: 'USD', status: 'ENABLED' },
  // Snapchat has no engine fixture yet; this account lets the adport side demo Snap previews and reports.
  { provider: SANDBOX_PROVIDER_ID, id: 'fixture-snap-0001', name: 'Demo · Snapchat Ads', currency: 'SAR', status: 'ENABLED' },
];

export function sandboxSeed(): SandboxCampaign[] {
  return [
    { id: 'g-101', accountId: 'fixture-google-0001', name: 'Brand Search - US', status: 'ENABLED', dailyBudgetMicros: 180_000_000 },
    { id: 'g-102', accountId: 'fixture-google-0001', name: 'Non-Brand Search - Pricing', status: 'ENABLED', dailyBudgetMicros: 420_000_000 },
    { id: 'g-103', accountId: 'fixture-google-0001', name: 'Performance Max - Prospecting', status: 'ENABLED', dailyBudgetMicros: 300_000_000 },
    { id: 'm-201', accountId: 'fixture-meta-0001', name: 'Prospecting - Lookalike 1%', status: 'ENABLED', dailyBudgetMicros: 350_000_000 },
    { id: 'm-202', accountId: 'fixture-meta-0001', name: 'Retargeting - Site Visitors 30d', status: 'ENABLED', dailyBudgetMicros: 150_000_000 },
    { id: 'm-203', accountId: 'fixture-meta-0001', name: 'Video Views - Awareness', status: 'PAUSED', dailyBudgetMicros: 90_000_000 },
    { id: 'r-301', accountId: 'fixture-reddit-0001', name: 'Community Targeting - Dev Tools', status: 'ENABLED', dailyBudgetMicros: 75_000_000 },
    { id: 'r-302', accountId: 'fixture-reddit-0001', name: 'Interest - Marketing', status: 'ENABLED', dailyBudgetMicros: 45_000_000 },
    { id: 's-401', accountId: 'fixture-snap-0001', name: 'Ramadan Awareness - KSA', status: 'ENABLED', dailyBudgetMicros: 500_000_000 },
    { id: 's-402', accountId: 'fixture-snap-0001', name: 'App Installs - Gulf', status: 'PAUSED', dailyBudgetMicros: 200_000_000 },
  ];
}

/** Storage scoped to one organization with atomic compare-and-set. */
export interface SandboxStateStore {
  load(): Promise<SandboxCampaign[]>;
  save(expected: SandboxCampaign[], next: SandboxCampaign[]): Promise<void>;
}

/** In-process store for tests and the CLI; the cloud app uses a Postgres-backed one. */
export class InMemorySandboxStore implements SandboxStateStore {
  private state: SandboxCampaign[];
  constructor(seed: SandboxCampaign[] = sandboxSeed()) { this.state = seed.map((c) => ({ ...c })); }
  async load() { return this.state.map((c) => ({ ...c })); }
  async save(expected: SandboxCampaign[], next: SandboxCampaign[]) {
    if (JSON.stringify(expected) !== JSON.stringify(this.state)) throw new AdportError('PENDING_MISMATCH', 'Sandbox state changed concurrently. Request a new preview.');
    this.state = next.map((c) => ({ ...c }));
  }
}

const budgetSchema = z.object({ campaign_id: z.string(), daily_budget_micros: z.number().int().positive().max(1_000_000_000_000) });
const statusSchema = z.object({ campaign_id: z.string(), status: z.enum(['ENABLED', 'PAUSED']) });

export class SandboxProvider implements AdProvider {
  readonly id = SANDBOX_PROVIDER_ID;
  constructor(private readonly store: SandboxStateStore) {}
  capabilities() { return { serverDryRun: false }; }
  async listAccounts() { return SANDBOX_ACCOUNTS.map((account) => ({ ...account })); }
  private account(id: string): Account {
    const account = SANDBOX_ACCOUNTS.find((candidate) => candidate.id === id);
    if (!account) throw new AdportError('POLICY_VIOLATION', `Account ${id} is not part of the sandbox workspace.`);
    return account;
  }
  async listCampaigns(accountId: string) {
    this.account(accountId);
    return sandboxStateSchema.parse(await this.store.load()).filter((campaign) => campaign.accountId === accountId);
  }
  async report(query: NormalizedQuery): Promise<Report> {
    for (const id of query.accountIds ?? []) this.account(id);
    const range = resolveDateRange(query.dateRange);
    const days = rangeDayCount(range);
    if (!Number.isFinite(days) || range.start > range.end || days > 366) throw new AdportError('INVALID_INPUT', 'Use a valid report range of at most 366 days.');
    const campaigns = sandboxStateSchema.parse(await this.store.load());
    const project = (base: Base): Record<MetricName, number> => {
      const m = withDerived(base);
      return Object.fromEntries(query.metrics.map((metric) => [metric, Math.round(m[metric] * 100) / 100])) as Record<MetricName, number>;
    };
    const rows: ReportRow[] = [];
    for (const account of SANDBOX_ACCOUNTS.filter((candidate) => !query.accountIds || query.accountIds.includes(candidate.id))) {
      const selected = campaigns.filter((campaign) => campaign.accountId === account.id);
      const nativeType = SANDBOX_GROUP_TYPE[account.id] ?? 'ad_group';
      if (query.level === 'account') {
        if (!selected.length) continue;
        const total = selected.reduce<Base>((acc, c) => addBase(acc, campaignBase(c, days)), emptyBase());
        rows.push({ provider: this.id, accountId: account.id, currency: account.currency,
          entity: { level: 'account', id: account.id, name: account.name, status: account.status }, metrics: project(total) });
        continue;
      }
      for (const campaign of selected) {
        const base = campaignBase(campaign, days);
        if (query.level === 'campaign') {
          rows.push({ provider: this.id, accountId: account.id, currency: account.currency,
            entity: { level: 'campaign', id: campaign.id, name: campaign.name, status: campaign.status }, metrics: project(base) });
          continue;
        }
        // Lower-hierarchy synthesis: deterministic ad_groups per campaign, ads per ad_group. Parent
        // linkage + provider-native entity type are preserved so the canonical hierarchy is real (the
        // data is CLEARLY SYNTHETIC — demo only). Child shares deliberately do not sum to the parent
        // exactly, mirroring how providers report overlapping attribution across levels.
        const groupSplits = [0.62, 0.38];
        groupSplits.forEach((gShare, gi) => {
          const gBase = scaleBase(base, gShare);
          const groupId = `${campaign.id}-ag${gi + 1}`;
          const groupName = `${campaign.name} · ${nativeType === 'adset' ? 'Ad set' : nativeType === 'ad_squad' ? 'Ad squad' : 'Ad group'} ${gi + 1}`;
          if (query.level === 'ad_group') {
            rows.push({ provider: this.id, accountId: account.id, currency: account.currency,
              entity: { level: 'ad_group', id: groupId, name: groupName, status: campaign.status, parentId: campaign.id, entityType: nativeType }, metrics: project(gBase) });
            return;
          }
          // query.level === 'ad'
          const adSplits = [0.56, 0.44];
          adSplits.forEach((aShare, ai) => {
            const aBase = scaleBase(gBase, aShare);
            rows.push({ provider: this.id, accountId: account.id, currency: account.currency,
              entity: { level: 'ad', id: `${groupId}-ad${ai + 1}`, name: `${groupName} · Ad ${ai + 1}`, status: campaign.status, parentId: groupId, entityType: 'ad' }, metrics: project(aBase) });
          });
        });
      }
    }
    return { rows: rows.slice(0, query.limit ?? 100), truncated: rows.length > (query.limit ?? 100) };
  }
  private async plan(op: WriteOperation) {
    const account = this.account(op.accountId);
    if (op.provider !== this.id || op.kind !== 'update') throw new AdportError('INVALID_INPUT', 'Unsupported sandbox operation.');
    const state = sandboxStateSchema.parse(await this.store.load());
    const find = (campaignId: string) => {
      const campaign = state.find((candidate) => candidate.accountId === op.accountId && candidate.id === campaignId);
      if (!campaign) throw new AdportError('INVALID_INPUT', `Campaign ${campaignId} was not found in sandbox account ${op.accountId}.`);
      return campaign;
    };
    if (op.tool === 'sandbox_set_budget') {
      const payload = budgetSchema.parse(op.payload);
      const campaign = find(payload.campaign_id);
      const preview: WritePreview = {
        summary: `Sandbox: change daily budget for "${campaign.name}"`,
        changes: [`~ campaign ${campaign.id} daily budget ${campaign.dailyBudgetMicros / 1e6} ${account.currency} → ${payload.daily_budget_micros / 1e6} ${account.currency}`],
        coercions: [],
        budgetDeltas: [{ target: `campaign ${campaign.id} daily budget`, currency: account.currency, fromMicros: campaign.dailyBudgetMicros, toMicros: payload.daily_budget_micros }],
        serverValidated: false,
      };
      return { state, preview, next: state.map((c) => (c === campaign ? { ...c, dailyBudgetMicros: payload.daily_budget_micros } : c)), campaign };
    }
    if (op.tool === 'sandbox_set_campaign_status') {
      const payload = statusSchema.parse(op.payload);
      const campaign = find(payload.campaign_id);
      const preview: WritePreview = {
        summary: `Sandbox: set "${campaign.name}" to ${payload.status}`,
        changes: [`~ campaign ${campaign.id} status ${campaign.status} → ${payload.status}`],
        coercions: [], budgetDeltas: [], serverValidated: false,
      };
      return { state, preview, next: state.map((c) => (c === campaign ? { ...c, status: payload.status } : c)), campaign };
    }
    throw new AdportError('INVALID_INPUT', `Unsupported sandbox tool ${op.tool}.`);
  }
  async previewWrite(op: WriteOperation) { return (await this.plan(op)).preview; }
  async applyWrite(op: WriteOperation): Promise<WriteResult> {
    const { state, next, campaign } = await this.plan(op);
    await this.store.save(state, next);
    return { applied: true, resourceIds: [campaign.id], details: { data_source: 'sandbox', real_ad_spend: false } };
  }
  standardActions() {
    return { pauseCampaign: (accountId: string, campaignId: string) => ({ tool: 'sandbox_set_campaign_status', input: { account_id: accountId, campaign_id: campaignId, status: 'PAUSED' } }) };
  }
}

export function sandboxTools(provider: SandboxProvider): AnyToolDefinition[] {
  return [
    defineTool({
      name: 'sandbox_list_campaigns', namespace: SANDBOX_PROVIDER_ID,
      description: 'List sandbox campaigns and current budgets. Synthetic data only.',
      input: z.object({ account_id: z.string() }), annotations: { readOnly: true, openWorld: false },
      async handler(input) { return { data_source: 'sandbox', campaigns: await provider.listCampaigns(input.account_id) }; },
    }),
    { ...guardedWriteTool({ name: 'sandbox_set_budget', namespace: SANDBOX_PROVIDER_ID, provider: SANDBOX_PROVIDER_ID, kind: 'update',
      description: 'Change a sandbox campaign daily budget through the normal preview/apply gate. No real ads or spend.', payload: budgetSchema }),
      annotations: { readOnly: false, destructive: true, openWorld: false } },
    { ...guardedWriteTool({ name: 'sandbox_set_campaign_status', namespace: SANDBOX_PROVIDER_ID, provider: SANDBOX_PROVIDER_ID, kind: 'update',
      description: 'Enable or pause a sandbox campaign through the normal preview/apply gate. No real ads or spend.', payload: statusSchema }),
      annotations: { readOnly: false, destructive: true, openWorld: false } },
  ];
}

/** Default engine alias → sandbox account bindings (the demo compose stack). */
export const SANDBOX_ALIASES = {
  'demo-google': { alias: 'demo-google', provider: SANDBOX_PROVIDER_ID, accountId: 'fixture-google-0001', currency: 'USD' },
  'demo-meta': { alias: 'demo-meta', provider: SANDBOX_PROVIDER_ID, accountId: 'fixture-meta-0001', currency: 'USD' },
  'demo-reddit': { alias: 'demo-reddit', provider: SANDBOX_PROVIDER_ID, accountId: 'fixture-reddit-0001', currency: 'USD' },
  'demo-snap': { alias: 'demo-snap', provider: SANDBOX_PROVIDER_ID, accountId: 'fixture-snap-0001', currency: 'SAR' },
} as const;
