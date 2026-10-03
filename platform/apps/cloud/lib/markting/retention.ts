/**
 * Phase 3U — data retention policy (declarative; enforcement is an operational sweep, not автonomous).
 * Declares a default retention window per data class and, crucially, which classes are IMMUTABLE
 * compliance/audit evidence that retention must NOT delete, versus business state that is correctable
 * and may be pruned. This module is the single source of truth a retention job (or a reviewer) reads.
 */
export type DataClass =
  | 'chat_threads' | 'recommendation_history' | 'recommendation_outcomes' | 'model_traces'
  | 'model_prompts' | 'reports' | 'marketing_memory' | 'usage_ledger' | 'decision_events'
  | 'audit_events' | 'pending_operations' | 'timeline_events';

export interface RetentionRule {
  /** null = retain indefinitely by policy (e.g. immutable audit); a number = default days. */
  defaultDays: number | null;
  /** True for immutable compliance/audit evidence that retention must never delete. */
  immutable: boolean;
  /** True when the subject can inspect/correct/delete (business memory), per 3F. */
  userCorrectable: boolean;
  note: string;
}

export const RETENTION_POLICY: Record<DataClass, RetentionRule> = {
  chat_threads: { defaultDays: 365, immutable: false, userCorrectable: false, note: 'Conversation history; prunable after a year unless the tenant opts to keep longer.' },
  recommendation_history: { defaultDays: 730, immutable: false, userCorrectable: false, note: 'Recommendations + lifecycle; kept for effectiveness analysis.' },
  recommendation_outcomes: { defaultDays: 730, immutable: false, userCorrectable: false, note: 'Measured outcomes; kept for calibration/learning.' },
  model_traces: { defaultDays: 180, immutable: false, userCorrectable: false, note: 'Usage/latency/cost metadata.' },
  model_prompts: { defaultDays: 30, immutable: false, userCorrectable: false, note: 'Stored prompts (if any) — short retention to limit exposure of embedded data.' },
  reports: { defaultDays: 365, immutable: false, userCorrectable: false, note: 'Generated reports.' },
  marketing_memory: { defaultDays: null, immutable: false, userCorrectable: true, note: 'Business memory — correctable/forgettable by the tenant; kept until revoked or expired.' },
  usage_ledger: { defaultDays: 730, immutable: false, userCorrectable: false, note: 'Cost/quota ledger; kept for billing reconciliation.' },
  decision_events: { defaultDays: null, immutable: true, userCorrectable: false, note: 'Append-only decision lifecycle — part of the audit trail; not user-rewritable.' },
  audit_events: { defaultDays: null, immutable: true, userCorrectable: false, note: 'Immutable compliance/audit evidence (Phase 0); never deleted by retention.' },
  pending_operations: { defaultDays: null, immutable: true, userCorrectable: false, note: 'Write-path record incl. terminal states; immutable audit evidence.' },
  timeline_events: { defaultDays: 730, immutable: false, userCorrectable: false, note: 'Observed account context for diagnostics.' },
};

/** Classes a retention sweep is allowed to delete past their window (immutable classes excluded). */
export function prunableClasses(): DataClass[] {
  return (Object.keys(RETENTION_POLICY) as DataClass[]).filter((c) => !RETENTION_POLICY[c].immutable && RETENTION_POLICY[c].defaultDays != null);
}
