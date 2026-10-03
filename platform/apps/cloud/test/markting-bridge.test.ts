import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContext, DEFAULT_POLICY, hashOperation, PolicyEngine, type AdportRuntime, type AuditEntry, type PendingOperation, type ClaimResult, type ApplyActor, type WriteResult } from '@adport/core';
import { applyPending, bridgeProposal, BridgeAccessError, type BridgeRecord } from '@/lib/markting/bridge';
import { InMemorySandboxStore, SANDBOX_ALIASES, SandboxProvider, sandboxTools } from '@/lib/markting/sandbox-provider';
import { syntheticProposal } from './fixtures/engine-proposal';

/** In-memory stand-ins for the Postgres pending/audit stores; same contracts as the cloud repository. */
class MemoryPending {
  rows = new Map<string, PendingOperation>();
  async put(op: PendingOperation) { this.rows.set(op.id, { ...op, state: op.state ?? 'pending' }); }
  async get(id: string) { const o = this.rows.get(id); return o ? { ...o } : undefined; }
  async claim(id: string, approver: ApplyActor): Promise<ClaimResult> {
    const o = this.rows.get(id);
    if (!o) return { status: 'not_found' };
    if (Date.parse(o.expiresAt) < Date.now()) return { status: 'expired', pending: { ...o } };
    const s = o.state ?? 'pending';
    if (s === 'applied') return { status: 'already_applied', result: o.result };
    if (s === 'applying') return { status: 'in_progress' };
    if (s === 'superseded' || s === 'expired' || s === 'failed') return { status: 'superseded' };
    if (s === 'rejected') return { status: 'rejected' };
    const claimed: PendingOperation = { ...o, state: 'applying', approvedBy: approver };
    this.rows.set(id, claimed);
    return { status: 'claimed', pending: { ...claimed } };
  }
  async markApplied(id: string, result: WriteResult) { const o = this.rows.get(id); if (o) this.rows.set(id, { ...o, state: 'applied', result }); }
  async markFailed(id: string) { const o = this.rows.get(id); if (o) this.rows.set(id, { ...o, state: 'failed' }); }
  async markSuperseded(id: string) { const o = this.rows.get(id); if (o) this.rows.set(id, { ...o, state: 'superseded' }); }
  async delete(id: string) { this.rows.delete(id); }
  async sweep(now = new Date()) { for (const [id, op] of this.rows) if (Date.parse(op.expiresAt) < now.getTime()) this.rows.delete(id); }
}
class MemoryAudit {
  entries: Array<Omit<AuditEntry, 'ts'>> = [];
  async append(entry: Omit<AuditEntry, 'ts'>) { this.entries.push(entry); }
}

async function demoRuntime(policy = DEFAULT_POLICY) {
  const store = new InMemorySandboxStore();
  const provider = new SandboxProvider(store);
  const applySpy = vi.spyOn(provider, 'applyWrite');
  const pending = new MemoryPending();
  const audit = new MemoryAudit();
  const runtime = await createContext({ providerModules: [{ provider, tools: sandboxTools(provider) }], engine: new PolicyEngine(policy, pending, audit) });
  return { runtime, store, pending, audit, applySpy };
}

function deps(runtime: AdportRuntime, overrides: Partial<Parameters<typeof bridgeProposal>[1]> = {}) {
  const records: BridgeRecord[] = [];
  const notes: Array<{ summary: string; pendingId?: string }> = [];
  const engineCalls: Array<{ proposalId: string; message: string }> = [];
  return {
    records, notes, engineCalls,
    deps: {
      runtime, aliases: SANDBOX_ALIASES, scopes: ['tools:read', 'tools:write'],
      record: async (record: BridgeRecord) => { records.push(record); },
      note: async (entry: { summary: string; pendingId?: string }) => { notes.push(entry); },
      rejectOnEngine: async (proposalId: string, message: string) => { engineCalls.push({ proposalId, message }); },
      ...overrides,
    },
  };
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network allowed in bridge tests'); })); });

describe('bridgeProposal: engine proposal → adport pending operation', () => {
  it('previews through the policy engine and lands a hash-bound pending row without applying', async () => {
    const { runtime, pending, audit, applySpy } = await demoRuntime();
    const { deps: d, records, notes, engineCalls } = deps(runtime);
    const result = await bridgeProposal(syntheticProposal(), d);
    expect(result.outcome).toBe('pending');
    if (result.outcome !== 'pending') throw new Error('unreachable');
    expect(pending.rows.size).toBe(1);
    const row = [...pending.rows.values()][0]!;
    expect(row.id).toBe(result.preview.pending_operation_id);
    expect(row.op).toEqual({ tool: 'sandbox_set_budget', provider: 'sandbox', accountId: 'fixture-google-0001', kind: 'update', payload: { campaign_id: 'g-103', daily_budget_micros: 240_000_000 } });
    expect(row.opHash).toBe(hashOperation(row.op));
    expect(row.preview.budgetDeltas).toEqual([{ target: 'campaign g-103 daily budget', currency: 'USD', fromMicros: 300_000_000, toMicros: 240_000_000 }]);
    expect(applySpy).not.toHaveBeenCalled();
    expect(audit.entries.map((entry) => entry.event)).toEqual(['validated']);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'pending', pendingOperationId: row.id, proposalId: syntheticProposal().proposal_id, revision: 1 });
    expect(notes[0]).toMatchObject({ pendingId: row.id, summary: expect.stringContaining('Engine proposal previewed') });
    expect(engineCalls).toEqual([{ proposalId: syntheticProposal().proposal_id, message: `handled by adport pending operation ${row.id}` }]);
  });

  it('applies later only with the identical operation plus pending id, through the same registry', async () => {
    const { runtime, pending, store, applySpy } = await demoRuntime();
    const result = await bridgeProposal(syntheticProposal(), deps(runtime).deps);
    if (result.outcome !== 'pending') throw new Error('unreachable');
    const row = pending.rows.get(result.preview.pending_operation_id)!;
    const applied = await applyPending(runtime, { id: row.id, operation: row.op as { tool: string; accountId: string; payload: Record<string, unknown> } }) as { status: string; applied: boolean };
    expect(applied).toMatchObject({ status: 'applied', applied: true });
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect((await store.load()).find((campaign) => campaign.id === 'g-103')?.dailyBudgetMicros).toBe(240_000_000);
    expect(pending.rows.get(row.id)?.state).toBe('applied');
  });

  it('refuses to apply altered arguments (PENDING_MISMATCH)', async () => {
    const { runtime, pending } = await demoRuntime();
    const result = await bridgeProposal(syntheticProposal(), deps(runtime).deps);
    if (result.outcome !== 'pending') throw new Error('unreachable');
    const row = pending.rows.get(result.preview.pending_operation_id)!;
    await expect(applyPending(runtime, { id: row.id, operation: { tool: row.op.tool, accountId: row.op.accountId, payload: { ...row.op.payload, daily_budget_micros: 10_000_000 } } }))
      .rejects.toMatchObject({ code: 'PENDING_MISMATCH' });
  });

  it('surfaces a policy violation (budget cap) as rejected_by_policy and records it', async () => {
    const { runtime, pending, audit } = await demoRuntime();
    const { deps: d, records, engineCalls } = deps(runtime);
    const result = await bridgeProposal(syntheticProposal({ after: [{ field: 'daily_budget', value: 900 }] }), d);
    expect(result).toMatchObject({ outcome: 'rejected_by_policy', code: 'POLICY_VIOLATION' });
    expect(pending.rows.size).toBe(0);
    expect(audit.entries.map((entry) => entry.event)).toEqual(['rejected']);
    expect(records[0]).toMatchObject({ status: 'rejected_by_policy', pendingOperationId: null });
    expect(engineCalls[0]?.message).toContain('refused');
  });

  it('refuses without tools:write even though the runtime itself would allow it', async () => {
    const { runtime, pending } = await demoRuntime();
    await expect(bridgeProposal(syntheticProposal(), deps(runtime, { scopes: ['tools:read'] }).deps)).rejects.toBeInstanceOf(BridgeAccessError);
    expect(pending.rows.size).toBe(0);
  });

  it('records unsupported proposals and touches nothing', async () => {
    const { runtime, pending, audit } = await demoRuntime();
    const { deps: d, records, engineCalls } = deps(runtime);
    const result = await bridgeProposal(syntheticProposal({ account_ref: 'foreign' }), d);
    expect(result.outcome).toBe('unsupported');
    expect(pending.rows.size).toBe(0);
    expect(audit.entries).toEqual([]);
    expect(records[0]?.status).toBe('unsupported');
    expect(engineCalls).toEqual([]);
  });

  it('keeps the adport record even when the engine hand-off fails', async () => {
    const { runtime, pending } = await demoRuntime();
    const result = await bridgeProposal(syntheticProposal(), deps(runtime, { rejectOnEngine: async () => { throw new Error('409 conflict'); } }).deps);
    expect(result.outcome).toBe('pending');
    expect(pending.rows.size).toBe(1);
  });

  it('never calls fetch (no provider or engine network from the bridge core)', async () => {
    const { runtime } = await demoRuntime();
    await bridgeProposal(syntheticProposal(), deps(runtime).deps);
    expect(fetch).not.toHaveBeenCalled();
  });
});
