import { describe, expect, it } from 'vitest';
import { createContext, DEFAULT_POLICY, PolicyEngine, type AuditEntry, type PendingOperation, type ClaimResult, type ApplyActor, type WriteResult } from '@adport/core';
import { InMemorySandboxStore, SANDBOX_ACCOUNTS, SandboxProvider, sandboxSeed, sandboxTools } from '@/lib/markting/sandbox-provider';

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
    if (s === 'superseded' || s === 'expired') return { status: 'superseded' };
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
class MemoryAudit { entries: Array<Omit<AuditEntry, 'ts'>> = []; async append(entry: Omit<AuditEntry, 'ts'>) { this.entries.push(entry); } }

async function runtime() {
  const store = new InMemorySandboxStore();
  const provider = new SandboxProvider(store);
  const pending = new MemoryPending();
  const audit = new MemoryAudit();
  const rt = await createContext({ providerModules: [{ provider, tools: sandboxTools(provider) }], engine: new PolicyEngine(DEFAULT_POLICY, pending, audit) });
  return { rt, store, pending, audit };
}

describe('SandboxProvider mirrors the engine fixtures and obeys the write gate', () => {
  it('exposes the four fixture accounts and ten campaigns with the fixture budgets', async () => {
    const { rt } = await runtime();
    const accounts = await rt.registry.call('accounts_list', {}, rt.ctx) as { accounts: Array<{ id: string; provider: string }> };
    expect(accounts.accounts.map((a) => a.id).sort()).toEqual(SANDBOX_ACCOUNTS.map((a) => a.id).sort());
    const google = await rt.registry.call('sandbox_list_campaigns', { account_id: 'fixture-google-0001' }, rt.ctx) as { campaigns: Array<{ id: string; dailyBudgetMicros: number }> };
    expect(google.campaigns.find((c) => c.id === 'g-103')?.dailyBudgetMicros).toBe(300_000_000);
    expect(sandboxSeed()).toHaveLength(10);
    expect(sandboxSeed().filter((c) => c.accountId === 'fixture-snap-0001')).toHaveLength(2);
  });

  it('answers the normalized report tool deterministically', async () => {
    const { rt } = await runtime();
    const first = await rt.registry.call('report', { metrics: ['spend', 'clicks', 'conversions', 'roas'], date_range: 'last_7_days' }, rt.ctx) as { rows: Array<{ provider: string; metrics: Record<string, number> }> };
    const second = await rt.registry.call('report', { metrics: ['spend', 'clicks', 'conversions', 'roas'], date_range: 'last_7_days' }, rt.ctx) as { rows: unknown[] };
    expect(first.rows).toHaveLength(10);
    expect(first.rows.every((row) => row.provider === 'sandbox' && (row.metrics.spend ?? 0) > 0)).toBe(true);
    expect(second.rows).toEqual(first.rows);
  });

  it('tool names avoid the demo/mock/synthetic prefixes the production connector refuses', async () => {
    const { rt } = await runtime();
    const names = rt.registry.list().filter((tool) => tool.namespace === 'sandbox').map((tool) => tool.name);
    expect(names.sort()).toEqual(['sandbox_list_campaigns', 'sandbox_set_budget', 'sandbox_set_campaign_status']);
    expect(names.some((name) => /^(demo|mock|synthetic)_/.test(name))).toBe(false);
  });

  it('two-step budget write: preview → pending → apply, with the 25% cap enforced', async () => {
    const { rt, store, pending } = await runtime();
    const preview = await rt.registry.call('sandbox_set_budget', { account_id: 'fixture-google-0001', campaign_id: 'g-103', daily_budget_micros: 240_000_000 }, rt.ctx) as { status: string; pending_operation_id: string; preview: { budgetDeltas: unknown[] } };
    expect(preview.status).toBe('pending_validation');
    expect(pending.rows.size).toBe(1);
    expect((await store.load()).find((c) => c.id === 'g-103')?.dailyBudgetMicros).toBe(300_000_000);
    const applied = await rt.registry.call('sandbox_set_budget', { account_id: 'fixture-google-0001', campaign_id: 'g-103', daily_budget_micros: 240_000_000, pending_operation_id: preview.pending_operation_id }, rt.ctx) as { status: string };
    expect(applied.status).toBe('applied');
    expect((await store.load()).find((c) => c.id === 'g-103')?.dailyBudgetMicros).toBe(240_000_000);
    await expect(rt.registry.call('sandbox_set_budget', { account_id: 'fixture-google-0001', campaign_id: 'g-103', daily_budget_micros: 900_000_000 }, rt.ctx)).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  });

  it('status write pauses a campaign through the gate and rejects unknown accounts/campaigns', async () => {
    const { rt, store } = await runtime();
    const preview = await rt.registry.call('sandbox_set_campaign_status', { account_id: 'fixture-meta-0001', campaign_id: 'm-201', status: 'PAUSED' }, rt.ctx) as { pending_operation_id: string };
    await rt.registry.call('sandbox_set_campaign_status', { account_id: 'fixture-meta-0001', campaign_id: 'm-201', status: 'PAUSED', pending_operation_id: preview.pending_operation_id }, rt.ctx);
    expect((await store.load()).find((c) => c.id === 'm-201')?.status).toBe('PAUSED');
    await expect(rt.registry.call('sandbox_set_campaign_status', { account_id: 'real-account', campaign_id: 'm-201', status: 'PAUSED' }, rt.ctx)).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    await expect(rt.registry.call('sandbox_set_campaign_status', { account_id: 'fixture-meta-0001', campaign_id: 'g-103', status: 'PAUSED' }, rt.ctx)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('refuses concurrent state changes (compare-and-set)', async () => {
    const store = new InMemorySandboxStore();
    const snapshot = await store.load();
    await store.save(snapshot, snapshot.map((c) => (c.id === 'g-101' ? { ...c, dailyBudgetMicros: 190_000_000 } : c)));
    await expect(store.save(snapshot, snapshot)).rejects.toMatchObject({ code: 'PENDING_MISMATCH' });
  });
});
