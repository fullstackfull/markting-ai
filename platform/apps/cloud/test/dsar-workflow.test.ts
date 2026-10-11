import { describe, expect, it } from 'vitest';
import { RETENTION_POLICY, prunableClasses, type DataClass } from '@/lib/markting/retention';
import {
  BlockedExternalPostgresDsarStore,
  InMemoryDsarStore,
  executeDsarPlan,
  executeRetentionSweep,
  planDsar,
  planRetentionSweep,
  type DsarApproval,
  type DsarSubjectRef,
} from '@/lib/markting/ops/dsar-workflow';

/**
 * Phase C.6 (25) — DSAR / retention workflow. Deterministic REVIEWABLE plans; execution is a separate
 * human-gated step over an injected in-memory store; immutable audit classes are never erased.
 */
const subject: DsarSubjectRef = { organizationId: 'org-1', subjectId: 'sub-1', kind: 'customer' };
const NOW = new Date('2026-10-04T00:00:00.000Z');
const approval: DsarApproval = { approvedBy: 'operator-1', reason: 'verified DSAR', at: NOW.toISOString() };

describe('planDsar', () => {
  it('ACCESS / EXPORT export every class and mutate nothing', () => {
    for (const type of ['ACCESS', 'EXPORT'] as const) {
      const plan = planDsar(type, subject, { now: NOW });
      expect(plan.items).toHaveLength(Object.keys(RETENTION_POLICY).length);
      expect(plan.items.every((i) => i.action === 'EXPORT')).toBe(true);
      expect(plan.requiresApproval).toBe(true);
      expect(plan.reviewable).toBe(true);
    }
  });

  it('ERASURE: immutable=RETAIN_IMMUTABLE, userCorrectable=ERASE, others=PSEUDONYMIZE', () => {
    const plan = planDsar('ERASURE', subject, { now: NOW });
    const byClass = new Map(plan.items.map((i) => [i.dataClass, i.action]));
    for (const dc of Object.keys(RETENTION_POLICY) as DataClass[]) {
      const rule = RETENTION_POLICY[dc];
      if (rule.immutable) expect(byClass.get(dc)).toBe('RETAIN_IMMUTABLE');
      else if (rule.userCorrectable) expect(byClass.get(dc)).toBe('ERASE');
      else expect(byClass.get(dc)).toBe('PSEUDONYMIZE');
    }
    // Immutable audit classes are present and explicitly RETAIN_IMMUTABLE.
    expect(byClass.get('audit_events')).toBe('RETAIN_IMMUTABLE');
    expect(byClass.get('decision_events')).toBe('RETAIN_IMMUTABLE');
    expect(byClass.get('pending_operations')).toBe('RETAIN_IMMUTABLE');
    // marketing_memory is the user-correctable class.
    expect(byClass.get('marketing_memory')).toBe('ERASE');
  });

  it('is deterministic (stable item order + identical plans)', () => {
    const a = planDsar('ERASURE', subject, { now: NOW });
    const b = planDsar('ERASURE', subject, { now: NOW });
    expect(a).toEqual(b);
    const classes = a.items.map((i) => i.dataClass);
    expect(classes).toEqual([...classes].sort());
  });

  it('summary counts add up', () => {
    const plan = planDsar('ERASURE', subject, { now: NOW });
    const total = plan.summary.EXPORT + plan.summary.ERASE + plan.summary.RETAIN_IMMUTABLE + plan.summary.PSEUDONYMIZE;
    expect(total).toBe(plan.items.length);
  });
});

describe('executeDsarPlan gating', () => {
  const seed = () => new InMemoryDsarStore([
    { id: 'm1', subjectId: 'sub-1', dataClass: 'marketing_memory', ageDays: 10 },
    { id: 'm2', subjectId: 'sub-1', dataClass: 'marketing_memory', ageDays: 20 },
    { id: 'c1', subjectId: 'sub-1', dataClass: 'chat_threads', ageDays: 5 },
    { id: 'a1', subjectId: 'sub-1', dataClass: 'audit_events', ageDays: 5 },
  ]);

  it('performs NO deletion without approval', async () => {
    const store = seed();
    const plan = planDsar('ERASURE', subject, { now: NOW });
    const res = await executeDsarPlan(plan, store, null);
    expect(res.approved).toBe(false);
    expect(res.executed).toHaveLength(0);
    expect(store.size()).toBe(4); // untouched
    expect(res.skipped.some((s) => s.dataClass === 'marketing_memory')).toBe(true);
  });

  it('erases user-correctable + pseudonymizes operational once approved, never immutable', async () => {
    const store = seed();
    const plan = planDsar('ERASURE', subject, { now: NOW });
    const res = await executeDsarPlan(plan, store, approval);
    expect(res.approved).toBe(true);
    const erased = res.executed.find((e) => e.dataClass === 'marketing_memory');
    expect(erased?.action).toBe('ERASE');
    expect(erased?.affected).toBe(2);
    expect(store.size('marketing_memory')).toBe(0);
    // chat_threads is operational -> pseudonymized, not deleted.
    const pseudo = res.executed.find((e) => e.dataClass === 'chat_threads');
    expect(pseudo?.action).toBe('PSEUDONYMIZE');
    expect(store.size('chat_threads')).toBe(1);
    // audit_events immutable -> retained, still present.
    expect(store.size('audit_events')).toBe(1);
    expect(res.executed.some((e) => e.dataClass === 'audit_events')).toBe(false);
  });

  it('respects a partial approval (approvedClasses)', async () => {
    const store = seed();
    const plan = planDsar('ERASURE', subject, { now: NOW });
    const res = await executeDsarPlan(plan, store, { ...approval, approvedClasses: ['marketing_memory'] });
    expect(res.executed.map((e) => e.dataClass)).toEqual(['marketing_memory']);
    expect(store.size('chat_threads')).toBe(1); // not approved -> untouched
  });

  it('EXPORT request reads rows into an export manifest without mutation', async () => {
    const store = seed();
    const plan = planDsar('EXPORT', subject, { now: NOW });
    const res = await executeDsarPlan(plan, store, approval);
    expect(res.executed).toHaveLength(0);
    expect(store.size()).toBe(4);
    const mm = res.exported.find((e) => e.dataClass === 'marketing_memory');
    expect(mm?.rows).toHaveLength(2);
  });

  it('refuses a malformed plan that erases an immutable class (hard invariant)', async () => {
    const store = seed();
    const plan = planDsar('ERASURE', subject, { now: NOW });
    const bad = { ...plan, items: plan.items.map((i) => (i.dataClass === 'audit_events' ? { ...i, action: 'ERASE' as const } : i)) };
    await expect(executeDsarPlan(bad, store, approval)).rejects.toThrow(/invariant/i);
  });
});

describe('retention sweep (plan only)', () => {
  const seed = () => new InMemoryDsarStore([
    { id: 'old1', subjectId: 's', dataClass: 'chat_threads', ageDays: 400 }, // > 365d
    { id: 'new1', subjectId: 's', dataClass: 'chat_threads', ageDays: 10 },
    { id: 'old2', subjectId: 's', dataClass: 'model_prompts', ageDays: 60 }, // > 30d
    { id: 'imm', subjectId: 's', dataClass: 'audit_events', ageDays: 9999 },
  ]);

  it('plans only prunable classes past their window and never immutable ones', async () => {
    const store = seed();
    const plan = await planRetentionSweep(store, { now: NOW });
    const classes = plan.items.map((i) => i.dataClass);
    expect(classes).toContain('chat_threads');
    expect(classes).toContain('model_prompts');
    expect(classes).not.toContain('audit_events');
    expect(plan.items.every((i) => prunableClasses().includes(i.dataClass))).toBe(true);
    // Planning deletes nothing.
    expect(store.size()).toBe(4);
    const chat = plan.items.find((i) => i.dataClass === 'chat_threads');
    expect(chat?.rowIds).toEqual(['old1']);
  });

  it('executes the sweep only when approved', async () => {
    const store = seed();
    const plan = await planRetentionSweep(store, { now: NOW });
    const refused = await executeRetentionSweep(plan, store, null);
    expect(refused.approved).toBe(false);
    expect(store.size()).toBe(4);
    const done = await executeRetentionSweep(plan, store, approval);
    expect(done.approved).toBe(true);
    expect(store.size('chat_threads')).toBe(1); // only the old row erased
    expect(store.size('audit_events')).toBe(1); // immutable untouched
  });
});

describe('BLOCKED_EXTERNAL Postgres stub', () => {
  it('throws a clearly-marked BLOCKED_EXTERNAL error rather than making a live call', async () => {
    const store = new BlockedExternalPostgresDsarStore();
    await expect(store.eraseRows()).rejects.toThrow(/BLOCKED_EXTERNAL/);
    await expect(store.listSubjectRows()).rejects.toThrow(/BLOCKED_EXTERNAL/);
  });
});
