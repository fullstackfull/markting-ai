import 'server-only';
import { randomUUID } from 'node:crypto';
import { recordAudit } from '@/lib/cloud/repository';
import type { TenantPrincipal } from '@/lib/cloud/types';
import { HttpError } from '@/lib/http';
import { bridgeProposal, BridgeAccessError, type BridgeResult } from './bridge';
import { EngineClient, EngineError } from './engine-client';
import { isDemoMode, marktingEnv } from './env';
import { claimThread, loadAliasMap, recordEngineProposal, threadIdFor } from './repository';
import { createBridgeRuntime } from './runtime';

export function engineClient(): EngineClient {
  const env = marktingEnv();
  return new EngineClient({ baseUrl: env.MARKTING_ENGINE_URL, token: env.MARKTING_ENGINE_TOKEN, timeoutMs: env.MARKTING_ENGINE_TIMEOUT_MS });
}

export interface AssistantTurn {
  threadId: string;
  text: string;
  bridge: BridgeResult | null;
  engine: { interrupted: boolean; available_actions: string[]; receipt: Record<string, unknown> | null };
  demoMode: boolean;
}

/**
 * One Assistant turn: forward the user's text to the engine from the server (the token never
 * reaches the browser), then, if the engine paused on a change proposal, convert it into an
 * adport preview through the policy engine and tell the engine it was handled.
 */
export async function runAssistantTurn(principal: TenantPrincipal, input: { threadId?: string; text: string }): Promise<AssistantTurn> {
  if (!principal.userId) throw new HttpError('A signed-in user is required.', 401);
  const text = input.text.trim();
  if (!text || text.length > 8000) throw new HttpError('Message must be between 1 and 8000 characters.', 400);
  const threadId = input.threadId && /^org_[0-9a-f-]{36}__u_[0-9a-f-]{36}__[A-Za-z0-9_-]{4,64}$/.test(input.threadId)
    ? input.threadId
    : threadIdFor(principal.organizationId, principal.userId, randomUUID().slice(0, 12));
  if (!threadId.startsWith(`org_${principal.organizationId}__u_${principal.userId}__`)) throw new HttpError('Thread belongs to another user.', 403);
  if (!(await claimThread(principal, threadId, text.slice(0, 80)))) throw new HttpError('Thread belongs to another user.', 403);

  const client = engineClient();
  let outcome;
  try {
    outcome = await client.sendMessage(threadId, text);
  } catch (error) {
    if (error instanceof EngineError) throw new HttpError(error.code === 'unreachable' ? 'The analysis engine is not reachable right now.' : error.message, error.status >= 500 ? 503 : error.status);
    throw error;
  }

  let bridge: BridgeResult | null = null;
  const proposal = outcome.proposal;
  if (proposal && proposal.state === 'awaiting_approval') {
    const demoMode = isDemoMode();
    const [runtime, aliases] = await Promise.all([createBridgeRuntime(principal), loadAliasMap(principal.organizationId, demoMode)]);
    // The preview (validate) originates from the AI engine's proposal, not the person viewing the
    // chat. Record the requester as the ai_agent so a human approver is always a distinct actor.
    runtime.ctx.writeActor = { type: 'ai_agent', id: 'engine' };
    try {
      bridge = await bridgeProposal(proposal, {
        runtime,
        aliases,
        scopes: principal.scopes,
        record: (record) => recordEngineProposal(principal, { ...record, threadId }),
        note: (entry) => recordAudit(principal, { event: 'note', ...entry }),
        rejectOnEngine: (proposalId, message) => client.rejectProposal(proposalId, message).then(() => undefined),
      });
    } catch (error) {
      if (error instanceof BridgeAccessError) throw new HttpError(error.message, error.status);
      throw error;
    }
  }
  return {
    threadId,
    text: outcome.text,
    bridge,
    engine: { interrupted: outcome.interrupted, available_actions: outcome.available_actions, receipt: outcome.receipt },
    demoMode: isDemoMode(),
  };
}
