import 'server-only';
import { db } from '@/lib/db';
import { assertTransition, type OperationState } from './state-machine';
import type { TypedProposedAction } from './actions';
import type { KillSwitch, WriteContext } from './kill-switch';
import { evaluateWriteBlocked } from './kill-switch';
import type { ChangeRecord } from './change-management';

/**
 * Phase 7 — tenant-scoped governance persistence. The server-derived organizationId is asserted before
 * every DB call. The atomic claim is a CONDITIONAL single-row UPDATE so only one worker can ever claim
 * an APPROVED operation. State transitions are guarded by the state machine before they are written.
 */

export async function createOperation(organizationId: string, op: {
  operationId: string; recommendationId?: string; pendingOperationId?: string; accountId: string; provider: string;
  action: TypedProposedAction; requesterUserId?: string; previewDigest: string; idempotencyKey?: string | null;
  riskClass?: string; beforeState?: unknown; approvalExpiresAt?: string; traceId?: string;
}): Promise<void> {
  await db()`
    insert into public.markting_operations
      (operation_id, organization_id, recommendation_id, pending_operation_id, account_id, provider, action_type,
       entity_id, entity_level, state, requester_user_id, preview_digest, idempotency_key, risk_class, before_state,
       requested_payload, approval_expires_at, trace_id, created_at, updated_at)
    values
      (${op.operationId}, ${organizationId}, ${op.recommendationId ?? null}, ${op.pendingOperationId ?? null}, ${op.accountId}, ${op.provider}, ${op.action.type},
       ${op.action.entityId}, ${op.action.entityLevel}, 'PREVIEWED', ${op.requesterUserId ?? null}, ${op.previewDigest}, ${op.idempotencyKey ?? null}, ${op.riskClass ?? null}, ${op.beforeState ? db().json(op.beforeState as never) : null},
       ${db().json(op.action as never)}, ${op.approvalExpiresAt ?? null}, ${op.traceId ?? null}, now(), now())`;
}

export async function getOperation(organizationId: string, operationId: string): Promise<{ state: OperationState; claimToken: string | null; requesterUserId: string | null } | null> {
  const rows = await db()<Array<{ state: OperationState; claimToken: string | null; requesterUserId: string | null }>>`
    select state, claim_token, requester_user_id from public.markting_operations where organization_id = ${organizationId} and operation_id = ${operationId} limit 1`;
  return rows[0] ?? null;
}

/** Transition an operation's state, guarded by the state machine (illegal transitions throw). */
export async function transitionOperation(organizationId: string, operationId: string, to: OperationState, patch: Record<string, unknown> = {}): Promise<void> {
  const cur = await getOperation(organizationId, operationId);
  if (!cur) throw new Error('operation not found');
  assertTransition(cur.state, to); // server-side illegal-transition guard
  await db()`
    update public.markting_operations set state = ${to}, updated_at = now(),
      provider_result = ${patch.providerResult ? db().json(patch.providerResult as never) : db()`provider_result`},
      after_state = ${patch.afterState ? db().json(patch.afterState as never) : db()`after_state`},
      failure_classification = ${(patch.failureClassification as string) ?? db()`failure_classification`},
      applied_at = ${to === 'APPLIED' ? db()`now()` : db()`applied_at`}
    where organization_id = ${organizationId} and operation_id = ${operationId}`;
}

export async function recordApproval(organizationId: string, operationId: string, approverUserId: string, roles: string[]): Promise<void> {
  await db()`
    insert into public.markting_operation_approvals (organization_id, operation_id, approver_user_id, roles)
    values (${organizationId}, ${operationId}, ${approverUserId}, ${db().json(roles as never)})
    on conflict (organization_id, operation_id, approver_user_id) do nothing`; // an actor approves at most once
}

export async function listApprovals(organizationId: string, operationId: string): Promise<Array<{ approverUserId: string; roles: string[] }>> {
  return db()<Array<{ approverUserId: string; roles: string[] }>>`
    select approver_user_id as "approverUserId", roles from public.markting_operation_approvals where organization_id = ${organizationId} and operation_id = ${operationId}`;
}

/**
 * ATOMIC CLAIM: conditional single-row UPDATE (APPROVED → CLAIMED) with a fresh token. Only one caller
 * can ever win; a second caller gets no row back. This is the single-writer guarantee for execution.
 */
export async function claimOperation(organizationId: string, operationId: string, claimToken: string): Promise<{ claimed: boolean }> {
  const rows = await db()<Array<{ operationId: string }>>`
    update public.markting_operations set state = 'CLAIMED', claim_token = ${claimToken}, updated_at = now()
    where organization_id = ${organizationId} and operation_id = ${operationId} and state = 'APPROVED' and claim_token is null
    returning operation_id as "operationId"`;
  return { claimed: rows.length === 1 };
}

// ---- Kill switches (cluster-safe, authoritative) ----
export async function listActiveKillSwitches(organizationId: string): Promise<KillSwitch[]> {
  const rows = await db()<Array<{ scope: KillSwitch['scope']; scopeKey: string; active: boolean; blocksReads: boolean; reason: string | null }>>`
    select scope, scope_key as "scopeKey", active, blocks_reads as "blocksReads", reason from public.markting_kill_switches
    where active = true and (organization_id is null or organization_id = ${organizationId})`;
  return rows.map((r) => ({ scope: r.scope, key: r.scopeKey, active: r.active, blocksReads: r.blocksReads, reason: r.reason ?? undefined }));
}

export async function setKillSwitch(input: { scope: KillSwitch['scope']; key: string; organizationId?: string; active: boolean; blocksReads?: boolean; reason?: string; setBy?: string }): Promise<void> {
  await db()`
    insert into public.markting_kill_switches (scope, scope_key, organization_id, active, blocks_reads, reason, set_by, set_at)
    values (${input.scope}, ${input.key}, ${input.organizationId ?? null}, ${input.active}, ${input.blocksReads ?? false}, ${input.reason ?? null}, ${input.setBy ?? null}, now())
    on conflict (scope, scope_key) do update set active = excluded.active, blocks_reads = excluded.blocks_reads, reason = excluded.reason, set_by = excluded.set_by, set_at = now()`;
}

/** Guard called before every provider write. Fails CLOSED: on a read error, treat as blocked. */
export async function assertWriteNotKilled(organizationId: string, ctx: WriteContext): Promise<{ allowed: boolean; reason?: string }> {
  let active: KillSwitch[];
  try { active = await listActiveKillSwitches(organizationId); }
  catch { return { allowed: false, reason: 'kill-switch state unreadable — failing closed (write blocked)' }; }
  const decision = evaluateWriteBlocked(ctx, active);
  return decision.blocked ? { allowed: false, reason: `blocked by ${decision.by} kill switch${decision.reason ? `: ${decision.reason}` : ''}` } : { allowed: true };
}

// ---- Change records (immutable) ----
export async function appendChangeRecord(rec: ChangeRecord): Promise<void> {
  await db()`
    insert into public.markting_change_records (organization_id, change_type, actor_user_id, before_value, after_value, reason, created_at)
    values (${rec.organizationId}, ${rec.changeType}, ${rec.actorUserId}, ${db().json(rec.before as never)}, ${db().json(rec.after as never)}, ${rec.reason}, ${rec.at})`;
}

// ---- Reconciliation jobs ----
export async function upsertReconciliationJob(organizationId: string, operationId: string, status: string, evidence: unknown, nextAttemptAt?: string): Promise<void> {
  await db()`
    insert into public.markting_reconciliation_jobs (organization_id, operation_id, status, attempts, evidence, next_attempt_at, updated_at)
    values (${organizationId}, ${operationId}, ${status}, 1, ${db().json(evidence as never)}, ${nextAttemptAt ?? null}, now())
    on conflict (organization_id, operation_id) do update set status = excluded.status, attempts = public.markting_reconciliation_jobs.attempts + 1, evidence = excluded.evidence, next_attempt_at = excluded.next_attempt_at, updated_at = now()`;
}

// ---- Provider health ----
export async function upsertProviderHealth(organizationId: string, provider: string, accountId: string, state: string, reason: string): Promise<void> {
  await db()`
    insert into public.markting_provider_health (organization_id, provider, account_id, state, reason, last_probe_at, updated_at)
    values (${organizationId}, ${provider}, ${accountId}, ${state}, ${reason}, now(), now())
    on conflict (organization_id, provider, account_id) do update set state = excluded.state, reason = excluded.reason, last_probe_at = now(), updated_at = now()`;
}
