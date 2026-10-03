import 'server-only';
import { AdportError } from '@adport/core';
import { db } from '@/lib/db';
import type { TenantPrincipal } from '@/lib/cloud/types';
import type { AliasBinding, AliasMap, Translation } from './translate';
import { SANDBOX_ALIASES, sandboxSeed, sandboxStateSchema, type SandboxCampaign, type SandboxStateStore } from './sandbox-provider';

// ---------------------------------------------------------------- threads

export interface ThreadRow { id: string; organizationId: string; userId: string | null; title: string | null; createdAt: Date; lastMessageAt: Date }

export function threadIdFor(organizationId: string, userId: string, suffix: string): string {
  return `org_${organizationId}__u_${userId}__${suffix}`.slice(0, 200);
}

/** Create-or-check a thread for this principal. Returns false when the thread belongs to someone else. */
export async function claimThread(principal: TenantPrincipal, threadId: string, title?: string): Promise<boolean> {
  const rows = await db()<ThreadRow[]>`
    insert into public.markting_threads (id, organization_id, user_id, title)
    values (${threadId}, ${principal.organizationId}, ${principal.userId ?? null}, ${title ?? null})
    on conflict (id) do update set last_message_at = now()
      where public.markting_threads.organization_id = ${principal.organizationId}
        and (public.markting_threads.user_id is null or public.markting_threads.user_id = ${principal.userId ?? null})
    returning id, organization_id, user_id, title, created_at, last_message_at
  `;
  return rows.length === 1;
}

/**
 * Claim the single in-flight turn for a thread (Phase 1N). Compare-and-set: succeeds only when no
 * turn is in flight (or a prior claim is stale > 5 min). Different threads/orgs are unaffected, so
 * they run in parallel. Returns false when another request already holds the thread.
 */
export async function beginThreadTurn(principal: TenantPrincipal, threadId: string, requestId: string): Promise<boolean> {
  const rows = await db()<Array<{ id: string }>>`
    update public.markting_threads
      set processing_request_id = ${requestId}, processing_at = now()
    where id = ${threadId} and organization_id = ${principal.organizationId}
      and (user_id is null or user_id = ${principal.userId ?? null})
      and (processing_request_id is null or processing_at < now() - interval '5 minutes')
    returning id
  `;
  return rows.length === 1;
}

/** Release the thread turn (only if we still hold it). Safe to call in a finally block. */
export async function endThreadTurn(principal: TenantPrincipal, threadId: string, requestId: string): Promise<void> {
  await db()`
    update public.markting_threads set processing_request_id = null, processing_at = null
    where id = ${threadId} and organization_id = ${principal.organizationId} and processing_request_id = ${requestId}
  `;
}

export async function listThreads(principal: TenantPrincipal, limit = 20): Promise<ThreadRow[]> {
  return db()<ThreadRow[]>`
    select id, organization_id, user_id, title, created_at, last_message_at
    from public.markting_threads
    where organization_id = ${principal.organizationId} and (user_id = ${principal.userId ?? null} or user_id is null)
    order by last_message_at desc limit ${limit}
  `;
}

// ---------------------------------------------------------------- aliases

export async function loadAliasMap(organizationId: string, demoMode: boolean): Promise<AliasMap> {
  const rows = await db()<Array<{ alias: string; provider: string; accountId: string; currency: string | null; targets: Record<string, string> }>>`
    select alias, provider, account_id, currency, targets from public.markting_account_aliases
    where organization_id = ${organizationId}
  `;
  const map: AliasMap = demoMode ? { ...SANDBOX_ALIASES } : {};
  for (const row of rows) {
    map[row.alias] = { alias: row.alias, provider: row.provider as AliasBinding['provider'], accountId: row.accountId, currency: row.currency ?? undefined, targets: row.targets ?? {} };
  }
  return map;
}

export async function upsertAlias(organizationId: string, binding: AliasBinding): Promise<void> {
  await db()`
    insert into public.markting_account_aliases (organization_id, alias, provider, account_id, currency, targets)
    values (${organizationId}, ${binding.alias}, ${binding.provider}, ${binding.accountId}, ${binding.currency ?? null}, ${db().json((binding.targets ?? {}) as never)})
    on conflict (organization_id, alias) do update set provider = excluded.provider, account_id = excluded.account_id, currency = excluded.currency, targets = excluded.targets
  `;
}

// ---------------------------------------------------------------- engine proposals (provenance)

export type BridgeStatus = 'pending' | 'unsupported' | 'rejected_by_policy' | 'applied' | 'rejected' | 'expired';

export interface EngineProposalRow {
  organizationId: string; proposalId: string; revision: number; threadId: string | null;
  enginePlatform: string; engineAccountRef: string; engineToolName: string; engineTargetRef: string;
  payloadDigest: string; proposal: Record<string, unknown>; translation: Translation;
  pendingOperationId: string | null; status: BridgeStatus; detail: string | null;
  createdBy: string | null; createdAt: Date; updatedAt: Date;
}

export async function recordEngineProposal(principal: TenantPrincipal, input: {
  proposalId: string; revision: number; threadId: string | null; platform: string; accountRef: string; toolName: string; targetRef: string;
  payloadDigest: string; proposal: Record<string, unknown>; translation: Translation; pendingOperationId: string | null; status: BridgeStatus; detail?: string;
}): Promise<void> {
  await db()`
    insert into public.markting_engine_proposals
      (organization_id, proposal_id, revision, thread_id, engine_platform, engine_account_ref, engine_tool_name, engine_target_ref,
       payload_digest, proposal, translation, pending_operation_id, status, detail, created_by)
    values
      (${principal.organizationId}, ${input.proposalId}, ${input.revision}, ${input.threadId}, ${input.platform}, ${input.accountRef},
       ${input.toolName}, ${input.targetRef}, ${input.payloadDigest}, ${db().json(input.proposal as never)}, ${db().json(input.translation as never)},
       ${input.pendingOperationId}, ${input.status}, ${input.detail ?? null}, ${principal.userId ?? null})
    on conflict (organization_id, proposal_id, revision) do update set
      translation = excluded.translation, pending_operation_id = excluded.pending_operation_id, status = excluded.status,
      detail = excluded.detail, updated_at = now()
  `;
}

export async function findEngineProposal(organizationId: string, proposalId: string, revision: number): Promise<EngineProposalRow | undefined> {
  const rows = await db()<EngineProposalRow[]>`
    select * from public.markting_engine_proposals
    where organization_id = ${organizationId} and proposal_id = ${proposalId} and revision = ${revision} limit 1
  `;
  return rows[0];
}

export async function provenanceForPending(organizationId: string, pendingIds: string[]): Promise<Map<string, EngineProposalRow>> {
  if (pendingIds.length === 0) return new Map();
  const rows = await db()<EngineProposalRow[]>`
    select * from public.markting_engine_proposals
    where organization_id = ${organizationId} and pending_operation_id in ${db()(pendingIds)}
  `;
  return new Map(rows.map((row) => [row.pendingOperationId!, row]));
}

export async function markPendingOutcome(organizationId: string, pendingOperationId: string, status: 'applied' | 'rejected' | 'expired', detail?: string): Promise<void> {
  await db()`
    update public.markting_engine_proposals set status = ${status}, detail = ${detail ?? null}, updated_at = now()
    where organization_id = ${organizationId} and pending_operation_id = ${pendingOperationId}
  `;
}

// ---------------------------------------------------------------- sandbox state

/** Postgres-backed sandbox state, one row per organization, compare-and-set on the serialized campaigns. */
export class PostgresSandboxStore implements SandboxStateStore {
  constructor(private readonly organizationId: string) {}

  async load(): Promise<SandboxCampaign[]> {
    const rows = await db()<Array<{ campaigns: unknown }>>`
      select campaigns from public.markting_sandbox_state where organization_id = ${this.organizationId}
    `;
    if (rows[0]) return sandboxStateSchema.parse(rows[0].campaigns);
    const seed = sandboxSeed();
    await db()`
      insert into public.markting_sandbox_state (organization_id, campaigns) values (${this.organizationId}, ${db().json(seed as never)})
      on conflict (organization_id) do nothing
    `;
    return seed;
  }

  async save(expected: SandboxCampaign[], next: SandboxCampaign[]): Promise<void> {
    const rows = await db()`
      update public.markting_sandbox_state
      set campaigns = ${db().json(next as never)}, version = version + 1, updated_at = now()
      where organization_id = ${this.organizationId} and campaigns = ${db().json(expected as never)}::jsonb
      returning version
    `;
    if (rows.length !== 1) throw new AdportError('PENDING_MISMATCH', 'Sandbox state changed concurrently. Request a new preview.');
  }
}

export async function resetSandboxState(organizationId: string): Promise<void> {
  await db()`delete from public.markting_sandbox_state where organization_id = ${organizationId}`;
}
