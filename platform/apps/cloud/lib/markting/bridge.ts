/**
 * Proposal bridge: engine proposal → adport preview (pending operation) → Approvals page.
 *
 * Pure orchestration over injected dependencies so it can be tested with in-memory stores and a
 * stubbed engine. The only way this module touches a provider is `runtime.registry.call(...)`
 * WITHOUT `pending_operation_id`, which runs `guardedWriteTool` → `PolicyEngine.validate`.
 * It never inserts into `pending_operations` and never approves anything on the engine side.
 */
import { AdportError, type AdportRuntime } from '@adport/core';
import { describeProposal, proposalViewSchema, translateProposal, type AliasMap, type ProposalView, type Translation } from './translate';

export interface PreviewOutput {
  status: 'pending_validation';
  applied: false;
  pending_operation_id: string;
  expires_at: string;
  preview: { summary: string; changes: string[]; coercions: string[]; budgetDeltas: unknown[]; serverValidated: boolean };
  next_step: string;
}

export interface BridgeRecord {
  proposalId: string;
  revision: number;
  platform: string;
  accountRef: string;
  toolName: string;
  targetRef: string;
  payloadDigest: string;
  proposal: Record<string, unknown>;
  translation: Translation;
  pendingOperationId: string | null;
  status: 'pending' | 'unsupported' | 'rejected_by_policy';
  detail?: string;
}

export interface BridgeDeps {
  runtime: AdportRuntime;
  aliases: AliasMap;
  /** Principal scopes; the bridge refuses without `tools:write` even if the runtime would allow it. */
  scopes: string[];
  /** Persist provenance. */
  record: (record: BridgeRecord) => Promise<void>;
  /** Audit note (adport `note` event) with the engine proposal summary. */
  note: (entry: { provider: string; tool: string; accountId: string; pendingId?: string; summary: string; details?: unknown }) => Promise<void>;
  /** Hand the proposal back to the engine as "handled". Never approve. */
  rejectOnEngine?: (proposalId: string, message: string) => Promise<void>;
}

export type BridgeResult =
  | { outcome: 'pending'; proposal: ProposalView; translation: Extract<Translation, { status: 'ok' }>; preview: PreviewOutput }
  | { outcome: 'unsupported'; proposal: ProposalView | null; reason: string }
  | { outcome: 'rejected_by_policy'; proposal: ProposalView; translation: Extract<Translation, { status: 'ok' }>; reason: string; code: string };

export class BridgeAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'BridgeAccessError'; }
}

export async function bridgeProposal(raw: unknown, deps: BridgeDeps): Promise<BridgeResult> {
  const parsed = proposalViewSchema.safeParse(raw);
  const translation = translateProposal(raw, deps.aliases);
  if (translation.status === 'unsupported') {
    if (parsed.success) {
      await deps.record(baseRecord(parsed.data, translation, null, 'unsupported', translation.reason));
    }
    return { outcome: 'unsupported', proposal: parsed.success ? parsed.data : null, reason: translation.reason };
  }
  const proposal = parsed.data!;
  if (!deps.scopes.includes('tools:write')) {
    throw new BridgeAccessError('This workspace plan or role does not allow write previews (tools:write).', 403);
  }
  const definition = deps.runtime.registry.get(translation.tool);
  if (definition.annotations.readOnly) throw new BridgeAccessError(`Tool ${translation.tool} is not a write tool.`, 409);
  const input = { ...translation.input, account_id: translation.accountId };
  let preview: PreviewOutput;
  try {
    preview = await deps.runtime.registry.call(translation.tool, input, deps.runtime.ctx) as PreviewOutput;
  } catch (error) {
    const code = error instanceof AdportError ? error.code : 'ERROR';
    const reason = error instanceof Error ? error.message : String(error);
    await deps.record(baseRecord(proposal, translation, null, 'rejected_by_policy', `${code}: ${reason}`.slice(0, 500)));
    await deps.note({ provider: translation.provider, tool: 'engine_proposal', accountId: translation.accountId, summary: `Engine proposal refused at preview (${code}): ${describeProposal(proposal)}`.slice(0, 500), details: { proposal_id: proposal.proposal_id, revision: proposal.revision, code } });
    await handoff(deps, proposal, `adport refused the preview (${code})`);
    return { outcome: 'rejected_by_policy', proposal, translation, reason, code };
  }
  if (preview.status !== 'pending_validation' || !preview.pending_operation_id) {
    throw new BridgeAccessError('The registry did not return a preview; refusing to continue.', 500);
  }
  await deps.record(baseRecord(proposal, translation, preview.pending_operation_id, 'pending'));
  await deps.note({
    provider: translation.provider, tool: 'engine_proposal', accountId: translation.accountId, pendingId: preview.pending_operation_id,
    summary: `Engine proposal previewed: ${describeProposal(proposal)}`.slice(0, 500),
    details: { proposal_id: proposal.proposal_id, revision: proposal.revision, payload_digest: proposal.payload_digest, risk: proposal.risk, risk_flags: proposal.risk_flags, reason: proposal.reason.slice(0, 500), notes: translation.notes },
  });
  await handoff(deps, proposal, `handled by adport pending operation ${preview.pending_operation_id}`);
  return { outcome: 'pending', proposal, translation, preview };
}

async function handoff(deps: BridgeDeps, proposal: ProposalView, message: string): Promise<void> {
  if (!deps.rejectOnEngine) return;
  try {
    await deps.rejectOnEngine(proposal.proposal_id, message);
  } catch {
    // The engine may already have moved the proposal on (409/500). The adport record is the source of truth.
  }
}

function baseRecord(proposal: ProposalView, translation: Translation, pendingOperationId: string | null, status: BridgeRecord['status'], detail?: string): BridgeRecord {
  return {
    proposalId: proposal.proposal_id, revision: proposal.revision, platform: proposal.platform, accountRef: proposal.account_ref,
    toolName: proposal.tool_name, targetRef: proposal.target_ref, payloadDigest: proposal.payload_digest,
    proposal: proposal as unknown as Record<string, unknown>, translation, pendingOperationId, status, detail,
  };
}

/**
 * Apply a previously previewed operation: the identical operation plus `pending_operation_id`
 * through the same registry, so `PolicyEngine.apply` verifies hash, expiry and policy.
 */
export async function applyPending(runtime: AdportRuntime, row: { id: string; operation: { tool: string; accountId: string; payload: Record<string, unknown> } }): Promise<unknown> {
  return runtime.registry.call(row.operation.tool, { ...row.operation.payload, account_id: row.operation.accountId, pending_operation_id: row.id }, runtime.ctx);
}
