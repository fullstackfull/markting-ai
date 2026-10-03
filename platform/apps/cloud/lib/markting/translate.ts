/**
 * Translate a paid-media-agent proposal into an adport guarded-write call.
 *
 * Pure module (no server imports) so it can be unit-tested with synthetic fixtures.
 * The engine never exposes provider account ids: `account_ref` is an opaque alias that only
 * the alias map on the adport side can resolve. Proposal prose never chooses the tool, the
 * account or the target: the tool is picked from a fixed allowlist and the account from the map.
 */
import { z } from 'zod';
import { microsToMinorUnits, AdportError } from '@adport/core';

/** Engine `Platform` enum values (engine/src/paid_media_agent/domain/common.py). */
export const ENGINE_PLATFORMS = [
  'google_ads', 'meta_ads', 'reddit_ads', 'tiktok_ads', 'snap_ads', 'pinterest_ads',
  'linkedin_ads', 'x_ads', 'google_analytics', 'openai_ads',
] as const;
export type EnginePlatform = typeof ENGINE_PLATFORMS[number];

/** Adport provider ids the bridge knows how to address. `sandbox` is the synthetic demo provider. */
export type BridgeProvider = 'sandbox' | 'google' | 'meta' | 'reddit' | 'tiktok' | 'snapchat';

const fieldValue = z.object({ field: z.string(), value: z.unknown(), unit: z.string().nullable().optional() });

/** The subset of `ProposalView` (engine/src/paid_media_agent/domain/presentation.py) the bridge reads. */
export const proposalViewSchema = z.object({
  version: z.string().optional(),
  proposal_id: z.string().uuid(),
  routing_id: z.string().optional(),
  revision: z.number().int().positive(),
  state: z.string(),
  platform: z.enum(ENGINE_PLATFORMS),
  account_ref: z.string().min(1).max(200),
  tool_name: z.string().min(1).max(200),
  target_ref: z.string().min(1).max(200),
  before: z.array(fieldValue),
  after: z.array(fieldValue).min(1),
  reason: z.string().max(2000),
  risk: z.string(),
  measurement_plan: z.string().max(4000).optional().default(''),
  reversal_plan: z.string().max(4000).optional().default(''),
  payload_digest: z.string(),
  catalog_revision: z.string().optional(),
  requester_ref: z.string().optional(),
  risk_flags: z.array(z.string()).optional().default([]),
});
export type ProposalView = z.infer<typeof proposalViewSchema>;

export interface AliasBinding {
  /** Engine account alias, e.g. `demo-google`. */
  alias: string;
  provider: BridgeProvider;
  accountId: string;
  /** ISO currency code of the account, used for the human preview only. */
  currency?: string;
  /** Optional engine target id → adport entity id map (demo fixtures share ids, live accounts may not). */
  targets?: Record<string, string>;
}

export type AliasMap = Record<string, AliasBinding>;

export type Translation =
  | { status: 'ok'; provider: BridgeProvider; accountId: string; tool: string; kind: 'update'; input: Record<string, unknown>; notes: string[] }
  | { status: 'unsupported'; reason: string };

/** Operation the engine proposed, derived strictly from the fixed `tool_name` suffix. */
export type EngineOperation = 'update_campaign_budget' | 'update_campaign_status';

const OPERATIONS: Record<string, EngineOperation> = {
  update_campaign_budget: 'update_campaign_budget',
  update_campaign_status: 'update_campaign_status',
};

const PLATFORM_TO_PROVIDER: Partial<Record<EnginePlatform, BridgeProvider>> = {
  google_ads: 'google', meta_ads: 'meta', reddit_ads: 'reddit', tiktok_ads: 'tiktok', snap_ads: 'snapchat',
};

export function engineOperation(toolName: string): { platform: string; operation: EngineOperation } | undefined {
  const separator = toolName.indexOf('__');
  if (separator <= 0) return undefined;
  const platform = toolName.slice(0, separator);
  const operation = OPERATIONS[toolName.slice(separator + 2)];
  return operation ? { platform, operation } : undefined;
}

export const MAX_DAILY_BUDGET_MICROS = 1_000_000_000_000; // 1,000,000 currency units/day: a sanity ceiling, not policy

function toMicros(value: unknown): number | undefined {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const micros = Math.round(amount * 1_000_000);
  if (micros > MAX_DAILY_BUDGET_MICROS) return undefined;
  return micros;
}

/** Engine statuses come from the fixture catalog enum: ENABLED | PAUSED | ACTIVE. */
function normalizeStatus(value: unknown): 'ACTIVE' | 'PAUSED' | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === 'PAUSED') return 'PAUSED';
  if (upper === 'ACTIVE' || upper === 'ENABLED' || upper === 'ENABLE') return 'ACTIVE';
  return undefined;
}

function budgetInput(provider: BridgeProvider, campaignId: string, micros: number, currency?: string): { tool: string; input: Record<string, unknown>; note: string } {
  switch (provider) {
    case 'sandbox': return { tool: 'sandbox_set_budget', input: { campaign_id: campaignId, daily_budget_micros: micros }, note: `${micros / 1e6} → ${micros} micros` };
    case 'google': return { tool: 'google_set_budget', input: { campaign_id: campaignId, daily_budget_micros: micros }, note: `${micros / 1e6} → ${micros} micros` };
    case 'meta': {
      // Meta budgets are the account currency's MINOR unit; convert with the currency exponent, not
      // a fixed /10_000 (which 100×-inflates JPY/KRW and 10×-understates KWD). Fail closed if the
      // account currency is unknown (R0-04).
      if (!currency) throw new AdportError('INVALID_INPUT', 'meta budget conversion requires the account currency; alias binding has none');
      const minor = microsToMinorUnits(micros, currency);
      return { tool: 'meta_set_budget', input: { object_id: campaignId, daily_budget_cents: minor }, note: `${micros / 1e6} ${currency} → ${minor} minor units` };
    }
    case 'reddit': return { tool: 'reddit_set_budget', input: { campaign_id: campaignId, budget_micros: micros, budget_type: 'DAILY_SPEND' }, note: `${micros / 1e6} → ${micros} micros (DAILY_SPEND)` };
    case 'snapchat': return { tool: 'snapchat_set_budget', input: { campaign_id: campaignId, field: 'daily_budget_micro', budget_micros: micros }, note: `${micros / 1e6} → ${micros} micros (daily_budget_micro)` };
    case 'tiktok': return { tool: 'tiktok_set_budget', input: { campaign_id: campaignId, budget: micros / 1e6 }, note: `${micros / 1e6} whole currency units` };
  }
}

function statusInput(provider: BridgeProvider, campaignId: string, status: 'ACTIVE' | 'PAUSED'): { tool: string; input: Record<string, unknown>; note: string } {
  switch (provider) {
    case 'sandbox': return { tool: 'sandbox_set_campaign_status', input: { campaign_id: campaignId, status: status === 'ACTIVE' ? 'ENABLED' : 'PAUSED' }, note: `status ${status}` };
    case 'google': return { tool: 'google_set_campaign_status', input: { campaign_id: campaignId, status: status === 'ACTIVE' ? 'ENABLED' : 'PAUSED' }, note: `status ${status} → ${status === 'ACTIVE' ? 'ENABLED' : 'PAUSED'}` };
    case 'meta': return { tool: 'meta_set_campaign_status', input: { campaign_id: campaignId, status }, note: `status ${status}` };
    case 'reddit': return { tool: 'reddit_set_campaign_status', input: { campaign_id: campaignId, configured_status: status }, note: `status ${status}` };
    case 'snapchat': return { tool: 'snapchat_set_campaign_status', input: { campaign_id: campaignId, status }, note: `status ${status}` };
    case 'tiktok': return { tool: 'tiktok_set_campaign_status', input: { campaign_ids: [campaignId], operation_status: status === 'ACTIVE' ? 'ENABLE' : 'DISABLE' }, note: `status ${status} → ${status === 'ACTIVE' ? 'ENABLE' : 'DISABLE'}` };
  }
}

/**
 * Translate a proposal. Returns `unsupported` instead of guessing whenever the platform, alias,
 * operation, target or value cannot be mapped unambiguously. Never throws on hostile input.
 */
export function translateProposal(raw: unknown, aliases: AliasMap): Translation {
  const parsed = proposalViewSchema.safeParse(raw);
  if (!parsed.success) return { status: 'unsupported', reason: `proposal failed validation: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}` };
  const proposal = parsed.data;
  const binding = aliases[proposal.account_ref];
  if (!binding) return { status: 'unsupported', reason: `no adport account is mapped to engine alias "${proposal.account_ref}"` };
  const operation = engineOperation(proposal.tool_name);
  if (!operation) return { status: 'unsupported', reason: `tool "${proposal.tool_name}" is not in the bridge allowlist` };
  if (operation.platform !== proposal.platform) return { status: 'unsupported', reason: `tool platform "${operation.platform}" does not match proposal platform "${proposal.platform}"` };
  const expectedProvider = PLATFORM_TO_PROVIDER[proposal.platform];
  if (binding.provider !== 'sandbox' && binding.provider !== expectedProvider) {
    return { status: 'unsupported', reason: `alias "${proposal.account_ref}" is bound to provider "${binding.provider}" but the proposal targets ${proposal.platform}` };
  }
  const campaignId = binding.targets?.[proposal.target_ref] ?? proposal.target_ref;
  if (!/^[A-Za-z0-9_:-]{1,120}$/.test(campaignId)) return { status: 'unsupported', reason: 'target id contains unexpected characters' };
  const notes: string[] = [`alias ${proposal.account_ref} → ${binding.provider}/${binding.accountId}`];
  if (campaignId !== proposal.target_ref) notes.push(`target ${proposal.target_ref} → ${campaignId}`);

  if (operation.operation === 'update_campaign_budget') {
    const after = proposal.after.find((entry) => entry.field === 'daily_budget');
    if (!after) return { status: 'unsupported', reason: 'budget proposal has no daily_budget field' };
    const micros = toMicros(after.value);
    if (micros === undefined) return { status: 'unsupported', reason: `daily_budget "${String(after.value)}" is not a positive amount within range` };
    let mapped: { tool: string; input: Record<string, unknown>; note: string };
    try {
      mapped = budgetInput(binding.provider, campaignId, micros, binding.currency);
    } catch (error) {
      return { status: 'unsupported', reason: error instanceof Error ? error.message : 'budget conversion failed' };
    }
    return { status: 'ok', provider: binding.provider, accountId: binding.accountId, tool: mapped.tool, kind: 'update', input: mapped.input, notes: [...notes, mapped.note] };
  }
  const after = proposal.after.find((entry) => entry.field === 'status');
  const status = normalizeStatus(after?.value);
  if (!status) return { status: 'unsupported', reason: `status "${String(after?.value)}" is not ACTIVE/ENABLED/PAUSED` };
  const mapped = statusInput(binding.provider, campaignId, status);
  return { status: 'ok', provider: binding.provider, accountId: binding.accountId, tool: mapped.tool, kind: 'update', input: mapped.input, notes: [...notes, mapped.note] };
}

/** Human summary used in audit notes and the chat UI. Prose fields are capped and never interpreted. */
export function describeProposal(proposal: ProposalView): string {
  const change = proposal.after.map((entry) => `${entry.field} → ${String(entry.value)}${entry.unit ? ` (${entry.unit})` : ''}`).join(', ');
  return `${proposal.tool_name} on ${proposal.target_ref}: ${change}`.slice(0, 500);
}
