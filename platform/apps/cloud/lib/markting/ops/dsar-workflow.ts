/**
 * Phase C.6 (25) — DSAR / RETENTION WORKFLOW engine (ACCESS / EXPORT / ERASURE). Given a subject ref
 * and the RETENTION_POLICY it produces a DETERMINISTIC, REVIEWABLE DsarPlan: every DataClass mapped to
 * an action (EXPORT / ERASE / RETAIN_IMMUTABLE / PSEUDONYMIZE) with a reason. Immutable audit classes
 * are RETAIN_IMMUTABLE and are NEVER erased; user-correctable classes ERASE; other operational classes
 * PSEUDONYMIZE. Planning performs NO deletion. Execution is a SEPARATE, human-GATED step over an
 * injected store port (in-memory fake). No autonomous deletion; no network. Matches retention.ts (no
 * 'server-only') — pure over its inputs and injected ports.
 */
import { RETENTION_POLICY, prunableClasses, type DataClass, type RetentionRule } from '@/lib/markting/retention';

export type DsarRequestType = 'ACCESS' | 'EXPORT' | 'ERASURE';
export type DsarAction = 'EXPORT' | 'ERASE' | 'RETAIN_IMMUTABLE' | 'PSEUDONYMIZE';

export interface DsarSubjectRef {
  organizationId: string;
  subjectId: string;
  kind?: 'customer' | 'user';
}

export interface DsarPlanItem {
  dataClass: DataClass;
  action: DsarAction;
  reason: string;
  immutable: boolean;
  userCorrectable: boolean;
}

export interface DsarPlan {
  request: { type: DsarRequestType; subject: DsarSubjectRef };
  items: DsarPlanItem[];
  generatedAt: string;
  /** The plan is a proposal only; it deletes nothing and requires human approval to execute. */
  reviewable: true;
  requiresApproval: true;
  summary: Record<DsarAction, number>;
}

function erasureAction(rule: RetentionRule): { action: DsarAction; reason: string } {
  if (rule.immutable) return { action: 'RETAIN_IMMUTABLE', reason: `immutable audit/compliance evidence — retention policy forbids deletion (${rule.note})` };
  if (rule.userCorrectable) return { action: 'ERASE', reason: `user-correctable business memory — subject may require deletion (${rule.note})` };
  return { action: 'PSEUDONYMIZE', reason: `operational data retained for analysis — subject identity reduced to a pseudonym rather than deleted (${rule.note})` };
}

/** Build a deterministic, reviewable DSAR plan. No side effects. */
export function planDsar(
  type: DsarRequestType,
  subject: DsarSubjectRef,
  opts: { policy?: Record<DataClass, RetentionRule>; now?: Date } = {},
): DsarPlan {
  const policy = opts.policy ?? RETENTION_POLICY;
  const now = opts.now ?? new Date();
  const items: DsarPlanItem[] = (Object.keys(policy) as DataClass[]).sort().map((dataClass) => {
    const rule = policy[dataClass];
    const base = { dataClass, immutable: rule.immutable, userCorrectable: rule.userCorrectable };
    if (type === 'ERASURE') {
      const { action, reason } = erasureAction(rule);
      return { ...base, action, reason };
    }
    // ACCESS / EXPORT: the subject receives a copy of every class; nothing is mutated.
    return { ...base, action: 'EXPORT', reason: `${type} request — export a copy of ${dataClass} for the subject (${rule.note})` };
  });
  const summary: Record<DsarAction, number> = { EXPORT: 0, ERASE: 0, RETAIN_IMMUTABLE: 0, PSEUDONYMIZE: 0 };
  for (const it of items) summary[it.action] += 1;
  return { request: { type, subject }, items, generatedAt: now.toISOString(), reviewable: true, requiresApproval: true, summary };
}

// ---- Execution: a SEPARATE, human-gated step over an injected store port ----
export interface DsarRow { id: string; data: Record<string, unknown> }

export interface DsarStorePort {
  listSubjectRows(ref: DsarSubjectRef, dataClass: DataClass): Promise<DsarRow[]>;
  eraseRows(dataClass: DataClass, ids: string[]): Promise<number>;
  pseudonymizeRows(dataClass: DataClass, ids: string[], pseudonym: string): Promise<number>;
}

export interface DsarApproval {
  approvedBy: string;
  reason: string;
  at: string;
  /** If omitted, every mutating item (ERASE / PSEUDONYMIZE) is approved; otherwise only the listed classes. */
  approvedClasses?: DataClass[];
}

export interface DsarExecutionResult {
  requestType: DsarRequestType;
  approved: boolean;
  executed: Array<{ dataClass: DataClass; action: DsarAction; affected: number }>;
  skipped: Array<{ dataClass: DataClass; action: DsarAction; reason: string }>;
  exported: Array<{ dataClass: DataClass; rows: DsarRow[] }>;
  at: string;
}

/**
 * Execute a reviewed plan. Without an approval nothing is deleted. Immutable classes are never erased
 * even if a malformed plan asked for it (hard invariant). Deterministic over the injected store.
 */
export async function executeDsarPlan(
  plan: DsarPlan,
  store: DsarStorePort,
  approval: DsarApproval | null,
  opts: { pseudonymFor?: (ref: DsarSubjectRef) => string } = {},
): Promise<DsarExecutionResult> {
  const at = approval?.at ?? plan.generatedAt;
  const result: DsarExecutionResult = { requestType: plan.request.type, approved: Boolean(approval), executed: [], skipped: [], exported: [], at };
  const pseudonym = (opts.pseudonymFor ?? ((r) => `pseudo:${r.organizationId}:${r.subjectId}`))(plan.request.subject);

  for (const item of plan.items) {
    // Hard invariant: immutable audit evidence is NEVER erased/pseudonymized, regardless of plan content.
    if (item.immutable && (item.action === 'ERASE' || item.action === 'PSEUDONYMIZE')) {
      throw new Error(`DSAR invariant violated: ${item.action} requested on immutable class ${item.dataClass}`);
    }
    if (item.action === 'RETAIN_IMMUTABLE') { result.skipped.push({ dataClass: item.dataClass, action: item.action, reason: 'immutable — retained by policy' }); continue; }
    if (item.action === 'EXPORT') {
      const rows = await store.listSubjectRows(plan.request.subject, item.dataClass);
      result.exported.push({ dataClass: item.dataClass, rows });
      continue;
    }
    // ERASE / PSEUDONYMIZE require approval of that class.
    const classApproved = approval != null && (approval.approvedClasses == null || approval.approvedClasses.includes(item.dataClass));
    if (!classApproved) { result.skipped.push({ dataClass: item.dataClass, action: item.action, reason: approval == null ? 'no approval — execution gated' : 'class not in approval set' }); continue; }
    const rows = await store.listSubjectRows(plan.request.subject, item.dataClass);
    const ids = rows.map((r) => r.id);
    const affected = item.action === 'ERASE' ? await store.eraseRows(item.dataClass, ids) : await store.pseudonymizeRows(item.dataClass, ids, pseudonym);
    result.executed.push({ dataClass: item.dataClass, action: item.action, affected });
  }
  return result;
}

// ---- Retention-sweep planner: which rows are past defaultDays. PLANS ONLY. ----
export interface RetentionStorePort {
  rowsOlderThan(dataClass: DataClass, cutoff: Date): Promise<string[]>;
  eraseRows(dataClass: DataClass, ids: string[]): Promise<number>;
}

export interface RetentionSweepItem { dataClass: DataClass; defaultDays: number; cutoff: string; rowIds: string[]; action: 'ERASE'; reason: string }
export interface RetentionSweepPlan { generatedAt: string; items: RetentionSweepItem[]; reviewable: true; totalRows: number }

/** Plan a retention sweep over prunable (non-immutable, windowed) classes. Deletes nothing. */
export async function planRetentionSweep(
  store: RetentionStorePort,
  opts: { now?: Date; policy?: Record<DataClass, RetentionRule> } = {},
): Promise<RetentionSweepPlan> {
  const policy = opts.policy ?? RETENTION_POLICY;
  const now = opts.now ?? new Date();
  const items: RetentionSweepItem[] = [];
  let totalRows = 0;
  for (const dataClass of prunableClasses()) {
    const rule = policy[dataClass];
    // Defensive: prunableClasses() already excludes immutable/null, but never sweep an immutable class.
    if (rule.immutable || rule.defaultDays == null) continue;
    const cutoff = new Date(now.getTime() - rule.defaultDays * 86_400_000);
    const rowIds = await store.rowsOlderThan(dataClass, cutoff);
    if (rowIds.length === 0) continue;
    totalRows += rowIds.length;
    items.push({ dataClass, defaultDays: rule.defaultDays, cutoff: cutoff.toISOString(), rowIds, action: 'ERASE', reason: `${rowIds.length} row(s) older than ${rule.defaultDays}d retention window (${rule.note})` });
  }
  return { generatedAt: now.toISOString(), items, reviewable: true, totalRows };
}

/** Execute a reviewed retention sweep. Gated — without an approval nothing is deleted. */
export async function executeRetentionSweep(
  plan: RetentionSweepPlan,
  store: RetentionStorePort,
  approval: DsarApproval | null,
): Promise<{ approved: boolean; executed: Array<{ dataClass: DataClass; affected: number }>; at: string }> {
  const at = approval?.at ?? plan.generatedAt;
  if (approval == null) return { approved: false, executed: [], at };
  const executed: Array<{ dataClass: DataClass; affected: number }> = [];
  const only = approval.approvedClasses;
  for (const item of plan.items) {
    if (only != null && !only.includes(item.dataClass)) continue;
    const affected = await store.eraseRows(item.dataClass, item.rowIds);
    executed.push({ dataClass: item.dataClass, affected });
  }
  return { approved: true, executed, at };
}

// ---- In-memory fakes (tests) ----
interface SeedRow { id: string; subjectId: string; dataClass: DataClass; ageDays: number; data?: Record<string, unknown> }

/** In-memory DSAR store fake — the injected durable-store port, with no external dependency. */
export class InMemoryDsarStore implements DsarStorePort, RetentionStorePort {
  private rows: SeedRow[];
  constructor(seed: SeedRow[] = []) { this.rows = seed.map((r) => ({ ...r })); }
  async listSubjectRows(ref: DsarSubjectRef, dataClass: DataClass): Promise<DsarRow[]> {
    return this.rows.filter((r) => r.subjectId === ref.subjectId && r.dataClass === dataClass).map((r) => ({ id: r.id, data: r.data ?? {} }));
  }
  async eraseRows(dataClass: DataClass, ids: string[]): Promise<number> {
    const set = new Set(ids);
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.dataClass === dataClass && set.has(r.id)));
    return before - this.rows.length;
  }
  async pseudonymizeRows(dataClass: DataClass, ids: string[], pseudonym: string): Promise<number> {
    const set = new Set(ids);
    let n = 0;
    for (const r of this.rows) {
      if (r.dataClass === dataClass && set.has(r.id)) { r.subjectId = pseudonym; r.data = { ...(r.data ?? {}), subjectId: pseudonym }; n += 1; }
    }
    return n;
  }
  async rowsOlderThan(dataClass: DataClass, cutoff: Date): Promise<string[]> {
    const cutoffAgeMs = Date.now() - cutoff.getTime();
    const cutoffDays = cutoffAgeMs / 86_400_000;
    return this.rows.filter((r) => r.dataClass === dataClass && r.ageDays >= cutoffDays).map((r) => r.id);
  }
  /** Test helper: current row count (optionally for one class). */
  size(dataClass?: DataClass): number { return dataClass ? this.rows.filter((r) => r.dataClass === dataClass).length : this.rows.length; }
}

/** A Postgres-backed DSAR store is BLOCKED_EXTERNAL here (no credentials) — a clearly-marked stub. */
export class BlockedExternalPostgresDsarStore implements DsarStorePort {
  private fail(): never { throw new Error('BLOCKED_EXTERNAL: Postgres DSAR store requires credentials not available in this environment'); }
  async listSubjectRows(): Promise<DsarRow[]> { this.fail(); }
  async eraseRows(): Promise<number> { this.fail(); }
  async pseudonymizeRows(): Promise<number> { this.fail(); }
}
