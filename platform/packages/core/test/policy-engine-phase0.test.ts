import { describe, expect, it } from 'vitest';
import { AuditLog } from '../src/policy/audit.js';
import { PolicyEngine } from '../src/policy/engine.js';
import {
  type ClaimResult,
  type PendingOperation,
  type PendingOperationStore,
} from '../src/policy/pending.js';
import { policySchema } from '../src/policy/policy.js';
import type { ApplyActor } from '../src/policy/actor.js';
import type { AuditEntry, AuditEntryStore } from '../src/policy/audit.js';
import type { WriteOperation, WriteResult } from '../src/provider.js';
import { MockProvider } from '../src/testing/mock-provider.js';

/**
 * Atomic in-memory pending store. `claim` performs its read-and-write with NO await in between, so
 * within Node's single-threaded event loop it is a true compare-and-set — exactly one of several
 * concurrent claimants of a `pending` row wins. This models the SQL `UPDATE … WHERE state='pending'
 * … RETURNING` that PostgresPendingStore uses in production; the engine orchestration under test is
 * identical. (The Postgres CAS itself is proven by a DB-gated test in CI.)
 */
class AtomicMemPendingStore implements PendingOperationStore {
  private rows = new Map<string, PendingOperation>();
  async put(op: PendingOperation): Promise<void> {
    this.rows.set(op.id, { ...op, state: op.state ?? 'pending' });
  }
  async get(id: string): Promise<PendingOperation | undefined> {
    const row = this.rows.get(id);
    return row ? { ...row } : undefined;
  }
  async claim(id: string, approver: ApplyActor): Promise<ClaimResult> {
    const row = this.rows.get(id); // read …
    if (!row) return { status: 'not_found' };
    if (Date.parse(row.expiresAt) < Date.now()) return { status: 'expired', pending: { ...row } };
    const state = row.state ?? 'pending';
    if (state === 'applied') return { status: 'already_applied', result: row.result };
    if (state === 'applying') return { status: 'in_progress' };
    if (state === 'superseded' || state === 'expired' || state === 'failed') return { status: 'superseded' };
    if (state === 'rejected') return { status: 'rejected' };
    const claimed: PendingOperation = { ...row, state: 'applying', approvedBy: approver };
    this.rows.set(id, claimed); // … and write, with no await between: atomic in the event loop.
    return { status: 'claimed', pending: { ...claimed } };
  }
  async markApplied(id: string, result: WriteResult): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, state: 'applied', result });
  }
  async markFailed(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, state: 'failed' });
  }
  async markSuperseded(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, state: 'superseded' });
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
  async sweep(): Promise<void> {}
}

class MemAudit implements AuditEntryStore {
  entries: AuditEntry[] = [];
  async append(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
    this.entries.push({ ...entry, ts: '2026-01-01T00:00:00Z' });
  }
}

/** Counts applyWrite calls and can block mid-apply so two applies overlap. */
class CountingProvider extends MockProvider {
  applyCalls = 0;
  private gate: Promise<void> | null = null;
  openGateWhen(p: Promise<void>) {
    this.gate = p;
  }
  override async applyWrite(op: WriteOperation, guard: never) {
    this.applyCalls += 1;
    if (this.gate) await this.gate;
    return super.applyWrite(op, guard as never);
  }
}

const HUMAN_A: ApplyActor = { type: 'human_user', id: 'user-a' };
const HUMAN_B: ApplyActor = { type: 'human_user', id: 'user-b' };
const API_CLIENT: ApplyActor = { type: 'api_client', id: 'key-1' };
const AI_AGENT: ApplyActor = { type: 'ai_agent', id: 'engine' };

function budgetOp(micros: number): WriteOperation {
  return { tool: 'mock_set_budget', provider: 'mock', accountId: 'mock-1', kind: 'update', payload: { campaign_id: 'c1', daily_budget_micros: micros } };
}

function makeEngine(overrides: Record<string, unknown> = {}) {
  const pending = new AtomicMemPendingStore();
  const audit = new MemAudit();
  const provider = new CountingProvider();
  const engine = new PolicyEngine(policySchema.parse(overrides), pending, audit);
  return { engine, pending, audit, provider };
}

describe('R0-01: atomic + idempotent apply', () => {
  it('two concurrent applies of one pending id produce exactly one provider write', async () => {
    const { engine, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), AI_AGENT);
    let release!: () => void;
    provider.openGateWhen(new Promise<void>((r) => { release = () => r(); }));

    const a = engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A });
    const b = engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_B });
    await Promise.resolve(); // let both reach the claim gate
    release();
    const results = await Promise.allSettled([a, b]);

    expect(provider.applyCalls).toBe(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    // One applies; the loser is either in-progress (claim lost) or an idempotent no-op (if the
    // winner finished first). Either way, never two writes.
    expect(fulfilled.length + rejected.length).toBe(2);
    if (rejected.length) expect(['APPLY_IN_PROGRESS', 'PENDING_NOT_FOUND']).toContain(rejected[0]!.reason.code);
  });

  it('a retried apply after success is an idempotent no-op (returns stored result, no second write)', async () => {
    const { engine, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), AI_AGENT);
    const first = await engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A });
    const retry = await engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A });
    expect(provider.applyCalls).toBe(1);
    expect(retry.result).toEqual(first.result);
  });

  it('a provider throw marks the pending FAILED (terminal, not re-claimable), never applied', async () => {
    const { engine, pending, audit, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), AI_AGENT);
    provider.openGateWhen(Promise.reject(new Error('provider down')));
    await expect(engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A })).rejects.toThrow('provider down');
    expect((await pending.get(pendingOperationId))?.state).toBe('failed');
    expect(audit.entries.map((e) => e.event)).toContain('applying');
    expect(audit.entries.map((e) => e.event)).not.toContain('applied');
    // A failed (indeterminate) apply is terminal: a blind retry must NOT re-execute the provider write.
    await expect(engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A }))
      .rejects.toMatchObject({ code: 'PENDING_SUPERSEDED' });
    expect(provider.applyCalls).toBe(1);
  });
});

describe('R0-02: human approval + four-eyes on every surface', () => {
  it('a non-human approver (API client / AI agent) cannot apply', async () => {
    const { engine, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), AI_AGENT);
    await expect(engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: API_CLIENT }))
      .rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(provider.applyCalls).toBe(0);
  });

  it('the requester cannot approve their own change unless self-approval is allowed', async () => {
    const { engine, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), HUMAN_A);
    await expect(engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A }))
      .rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    const ok = await engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A, allowSelfApproval: true });
    expect(ok.result.applied).toBe(true);
  });

  it('a different human may approve a change another actor requested', async () => {
    const { engine, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), HUMAN_A);
    const ok = await engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_B });
    expect(ok.result.applied).toBe(true);
  });
});

describe('R0-03: generic API passthrough is fail-closed on the sanctioned path', () => {
  it('rejects a generic *_api_update at validate unless policy opts in', async () => {
    const { engine, provider } = makeEngine();
    const generic: WriteOperation = { tool: 'mock_api_update', provider: 'mock', accountId: 'mock-1', kind: 'update', payload: { object_id: 'c1', fields: { status: 'ENABLED' } } };
    await expect(engine.validate(provider, generic, AI_AGENT)).rejects.toMatchObject({ code: 'GENERIC_WRITE_DISABLED' });
    const opted = makeEngine({ allow_generic_api_writes: true });
    // With the opt-in the gate passes; MockProvider has no such tool, so it fails later, NOT at the gate.
    await expect(opted.engine.validate(opted.provider, generic, AI_AGENT)).rejects.not.toMatchObject({ code: 'GENERIC_WRITE_DISABLED' });
  });
});

describe('R0-06: apply-time revalidation + immutable preview', () => {
  it('re-checks budget caps against live state at apply', async () => {
    const { engine, provider } = makeEngine(); // default 25% delta cap
    const { pendingOperationId } = await engine.validate(provider, budgetOp(12_000_000), AI_AGENT); // 10M→12M, 20% ok
    // Live state moves: current budget drops to 5M, so 5M→12M is +140% at apply time.
    provider.listCampaigns('mock-1').find((c) => c.id === 'c1')!.dailyBudgetMicros = 5_000_000;
    await expect(engine.apply(provider, budgetOp(12_000_000), pendingOperationId, { approver: HUMAN_A }))
      .rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    expect(provider.applyCalls).toBe(0);
  });

  it('refuses to apply a preview that no longer matches live state (REPREVIEW_REQUIRED)', async () => {
    const { engine, pending, provider } = makeEngine();
    const { pendingOperationId } = await engine.validate(provider, budgetOp(11_000_000), AI_AGENT); // 10M→11M
    // Live drift within cap, but the preview (from→to) differs: 10.5M→11M.
    provider.listCampaigns('mock-1').find((c) => c.id === 'c1')!.dailyBudgetMicros = 10_500_000;
    await expect(engine.apply(provider, budgetOp(11_000_000), pendingOperationId, { approver: HUMAN_A }))
      .rejects.toMatchObject({ code: 'REPREVIEW_REQUIRED' });
    expect(provider.applyCalls).toBe(0);
    expect((await pending.get(pendingOperationId))?.state).toBe('superseded');
  });
});
