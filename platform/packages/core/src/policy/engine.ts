import { createHash, randomUUID } from 'node:crypto';
import { AdportError } from '../errors.js';
import type { AdProvider, WriteGuard, WriteOperation, WritePreview, WriteResult } from '../provider.js';
import { AuditLog, type AuditEntryStore } from './audit.js';
import { PendingStore, type PendingOperationStore } from './pending.js';
import type { Policy } from './policy.js';
import { isHumanApprover, sameActor, LOCAL_OPERATOR, type ApplyActor } from './actor.js';
import { classifyWriteRisk, isGenericApiTool } from './risk.js';

export interface ValidationOutcome {
  pendingOperationId: string;
  preview: WritePreview;
  expiresAt: string;
}

export interface ApplyOutcome {
  result: WriteResult;
  preview: WritePreview;
}

/** Approval context supplied by the hosting app at apply time. */
export interface ApplyApproval {
  /** The actor approving/applying. When omitted, the engine runs in local/library trusted mode. */
  approver?: ApplyActor;
  /** Let the requester approve their own change (single-operator demos only). Default false. */
  allowSelfApproval?: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

export function hashOperation(op: WriteOperation): string {
  const canonical = canonicalize({
    tool: op.tool,
    provider: op.provider,
    accountId: op.accountId,
    kind: op.kind,
    payload: op.payload,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Digest of the *material*, state-sensitive fields of a preview. The approver approves a specific
 * preview; if live state moves between validate and apply so that the effect would differ, the
 * digest changes and apply refuses rather than silently applying a stale preview (R0-06 / SEC-17).
 */
export function previewDigest(preview: WritePreview): string {
  const canonical = canonicalize({
    summary: preview.summary,
    changes: preview.changes,
    coercions: preview.coercions,
    budgetDeltas: preview.budgetDeltas,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * The single gate for all mutations. Enforces the two-step contract:
 * validate() dry-runs the operation and issues a pending-operation id;
 * apply() atomically claims the pending id, re-checks policy against live state, and only then
 * executes — exactly once per approval, by a human distinct from the requester.
 */
export class PolicyEngine {
  constructor(
    readonly policy: Policy,
    private readonly pending: PendingOperationStore = new PendingStore(),
    private readonly audit: AuditEntryStore = new AuditLog(),
  ) {}

  guard(): WriteGuard {
    return { forcePausedCreation: this.policy.paused_creation };
  }

  async validate(provider: AdProvider, op: WriteOperation, requestedBy?: ApplyActor): Promise<ValidationOutcome> {
    await this.pending.sweep(); // opportunistic cleanup of expired entries
    await this.checkStaticPolicy(op);
    this.checkToolPolicy(op);
    const preview = await provider.previewWrite(op, this.guard());
    await this.checkBudgetPolicy(op, preview);

    const id = randomUUID();
    const now = Date.now();
    const expiresAt = new Date(now + this.policy.pending_ttl_minutes * 60_000).toISOString();
    await this.pending.put({
      id,
      provider: provider.id,
      opHash: hashOperation(op),
      op,
      preview,
      previewDigest: previewDigest(preview),
      createdAt: new Date(now).toISOString(),
      expiresAt,
      state: 'pending',
      requestedBy,
    });
    await this.audit.append({
      event: 'validated',
      provider: provider.id,
      tool: op.tool,
      accountId: op.accountId,
      pendingId: id,
      summary: preview.summary,
      details: { risk: classifyWriteRisk(op), requestedBy },
    });
    return { pendingOperationId: id, preview, expiresAt };
  }

  async apply(
    provider: AdProvider,
    op: WriteOperation,
    pendingId: string,
    approval: ApplyApproval = {},
  ): Promise<ApplyOutcome> {
    const approver = approval.approver;

    // 1. Peek (no consume) for client errors that must not burn a reusable pending row.
    const peek = await this.pending.get(pendingId);
    if (!peek) {
      throw new AdportError(
        'PENDING_NOT_FOUND',
        `No pending operation "${pendingId}". Validate first: call the tool without pending_operation_id.`,
      );
    }
    if (Date.parse(peek.expiresAt) < Date.now()) {
      await this.pending.markSuperseded(pendingId).catch(() => {});
      throw new AdportError(
        'PENDING_EXPIRED',
        `Pending operation ${pendingId} expired at ${peek.expiresAt}. Validate again.`,
      );
    }
    // Idempotent replay: a completed apply returns its stored result, never a second write.
    if ((peek.state ?? 'pending') === 'applied') {
      return { result: peek.result ?? { applied: true, resourceIds: [] }, preview: peek.preview };
    }
    if (peek.provider !== provider.id || peek.opHash !== hashOperation(op)) {
      throw new AdportError(
        'PENDING_MISMATCH',
        'The operation differs from what was validated. Re-validate with the exact arguments you intend to apply.',
      );
    }

    // 2. Human approval + four-eyes (no consume on failure).
    this.checkApproval(approver, peek.requestedBy, approval.allowSelfApproval ?? false);

    // 3. Atomic claim: exactly one concurrent apply transitions pending → applying.
    const claim = await this.pending.claim(pendingId, approver ?? LOCAL_OPERATOR);
    switch (claim.status) {
      case 'not_found':
        throw new AdportError('PENDING_NOT_FOUND', `No pending operation "${pendingId}".`);
      case 'expired':
        throw new AdportError('PENDING_EXPIRED', `Pending operation ${pendingId} expired. Validate again.`);
      case 'in_progress':
        throw new AdportError(
          'APPLY_IN_PROGRESS',
          `Pending operation ${pendingId} is already being applied. A concurrent or prior apply holds it; not re-executing.`,
        );
      case 'already_applied':
        return { result: claim.result ?? { applied: true, resourceIds: [] }, preview: peek.preview };
      case 'superseded':
        throw new AdportError('PENDING_SUPERSEDED', `Pending operation ${pendingId} was superseded. Validate again.`);
      case 'rejected':
        throw new AdportError('PENDING_REJECTED', `Pending operation ${pendingId} was rejected.`);
      case 'claimed':
        break;
    }
    const pending = claim.pending;

    try {
      // 4. Re-validate against LIVE state (R0-06): policy, tool gate, budget caps on a fresh preview.
      await this.checkStaticPolicy(op);
      this.checkToolPolicy(op);
      const fresh = await provider.previewWrite(op, this.guard());
      await this.checkBudgetPolicy(op, fresh);

      // 5. Immutable preview: refuse to apply if live state diverged from what was approved.
      if (pending.previewDigest && previewDigest(fresh) !== pending.previewDigest) {
        await this.pending.markSuperseded(pendingId);
        await this.audit.append({
          event: 'rejected',
          provider: provider.id,
          tool: op.tool,
          accountId: op.accountId,
          pendingId,
          summary: `Re-preview required: live state changed since approval (${pending.preview.summary} → ${fresh.summary})`.slice(0, 500),
        });
        throw new AdportError(
          'REPREVIEW_REQUIRED',
          'Live account state changed since this was approved. The approved preview is no longer valid; validate again to review the new effect.',
          { approvedPreview: pending.preview, currentPreview: fresh },
        );
      }

      // 6. Pre-write intent row (SEC-08): a completed-but-uncommitted write is reconstructable.
      await this.audit.append({
        event: 'applying',
        provider: provider.id,
        tool: op.tool,
        accountId: op.accountId,
        pendingId,
        summary: fresh.summary,
        details: { risk: classifyWriteRisk(op), approvedBy: approver, requestedBy: pending.requestedBy },
      });

      const result = await provider.applyWrite(op, this.guard());
      await this.audit.append({
        event: 'applied',
        provider: provider.id,
        tool: op.tool,
        accountId: op.accountId,
        pendingId,
        summary: fresh.summary,
        details: { resourceIds: result.resourceIds, approvedBy: approver },
      });
      await this.pending.markApplied(pendingId, result);
      return { result, preview: fresh };
    } catch (error) {
      if (error instanceof AdportError && (error.code === 'REPREVIEW_REQUIRED' || error.code === 'POLICY_VIOLATION')) {
        // Already recorded + state transitioned (superseded/failed-by-reject). Re-throw as-is.
        if (error.code === 'POLICY_VIOLATION') await this.pending.markFailed(pendingId, error.message).catch(() => {});
        throw error;
      }
      // Provider write threw: the write may or may not have landed. Mark failed (indeterminate) and
      // never write an 'applied' row. A failed apply is TERMINAL and is NOT re-claimable — retrying
      // requires an explicit fresh validate, so an uncertain result can never be blindly re-executed
      // (which would risk a duplicate create).
      await this.pending.markFailed(pendingId, error instanceof Error ? error.message : String(error));
      await this.audit.append({
        event: 'rejected',
        provider: provider.id,
        tool: op.tool,
        accountId: op.accountId,
        pendingId,
        summary: `Apply failed (indeterminate): ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
      });
      throw error;
    }
  }

  private checkApproval(approver: ApplyActor | undefined, requester: ApplyActor | undefined, allowSelfApproval: boolean): void {
    // Library/local mode: no hosted session supplied an approver. The local CLI/MCP operator is the
    // trusted single user. Hosted surfaces ALWAYS pass an approver (see createContext default + the
    // cloud runtimes), so this branch is never the hosted path.
    if (approver === undefined) return;
    if (!isHumanApprover(approver)) {
      throw new AdportError(
        'APPROVAL_REQUIRED',
        'Applying a change requires a human approver. API keys, OAuth clients, and the AI engine may request a change (create a preview) but cannot apply it; a person must approve it.',
      );
    }
    if (sameActor(approver, requester) && !allowSelfApproval) {
      throw new AdportError(
        'SELF_APPROVAL_FORBIDDEN',
        'The person who requested a change cannot approve it. A different person must apply it (or enable self-approval for single-operator demos).',
      );
    }
  }

  /** Fail closed on untyped generic API passthroughs unless policy explicitly allows them (R0-03). */
  private checkToolPolicy(op: WriteOperation): void {
    if (isGenericApiTool(op.tool) && !this.policy.allow_generic_api_writes) {
      throw new AdportError(
        'GENERIC_WRITE_DISABLED',
        `Generic API tool "${op.tool}" (risk: ${classifyWriteRisk(op)}) is disabled on the sanctioned write path because it bypasses semantic risk classification. Use a typed operation, or set allow_generic_api_writes in policy to opt in explicitly.`,
      );
    }
  }

  private async checkStaticPolicy(op: WriteOperation): Promise<void> {
    if (this.policy.protected_accounts.includes(op.accountId)) {
      await this.reject(op, `Account ${op.accountId} is protected by policy`);
    }
  }

  private async checkBudgetPolicy(op: WriteOperation, preview: WritePreview): Promise<void> {
    const pctCap = this.policy.max_budget_delta_pct;
    const absCap = this.policy.max_daily_budget_micros;
    for (const delta of preview.budgetDeltas) {
      if (absCap !== null && delta.toMicros > absCap) {
        await this.reject(
          op,
          `${delta.target}: ${delta.toMicros} micros exceeds the absolute budget cap (${absCap})`,
        );
      }
      if (pctCap !== null && delta.fromMicros !== undefined && delta.fromMicros > 0) {
        const pct = (Math.abs(delta.toMicros - delta.fromMicros) / delta.fromMicros) * 100;
        if (pct > pctCap) {
          await this.reject(
            op,
            `${delta.target}: ${pct.toFixed(1)}% change exceeds the ${pctCap}% budget-delta cap`,
          );
        }
      }
    }
  }

  private async reject(op: WriteOperation, reason: string): Promise<never> {
    await this.audit.append({
      event: 'rejected',
      provider: op.provider,
      tool: op.tool,
      accountId: op.accountId,
      summary: reason,
    });
    throw new AdportError('POLICY_VIOLATION', `Policy violation: ${reason}`, { policy: this.policy });
  }
}
