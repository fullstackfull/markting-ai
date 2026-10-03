/**
 * Phase 2Y — intelligent alerts without spam. Candidate alerts are filtered by a severity floor, then
 * deduplicated by a stable key, then suppressed by a cooldown window so the same unresolved anomaly is
 * not re-sent every run. The channel architecture is extensible (channels are named, not hard-wired);
 * Phase 2 does not need to implement every external transport.
 */
import type { AnomalyClass, Severity } from './decision-model';

export type NotificationChannel = 'in_app' | 'email' | 'slack' | 'webhook';

export interface AlertCandidate {
  /** Stable dedup key, e.g. `${entityId}:${diagnosisType}`. */
  key: string;
  organizationId: string;
  severity: Severity | AnomalyClass;
  title: string;
  /** When the underlying condition was observed (ms). */
  observedAt: number;
}

export interface NotificationState {
  /** Last send time per key (ms), for cooldown. */
  lastSentAt: Record<string, number>;
}

export interface NotificationPlan {
  toSend: AlertCandidate[];
  suppressed: Array<{ key: string; reason: 'below_floor' | 'duplicate' | 'cooldown' }>;
}

export interface NotificationOptions {
  /** Minimum severity to notify at all. */
  floor?: Severity | AnomalyClass;
  /** Cooldown per key (ms) — a key sent within this window is suppressed. */
  cooldownMs?: number;
  now?: number;
}

const RANK: Record<string, number> = { INFO: 0, WATCH: 1, ATTENTION: 2, ACTIONABLE: 2, CRITICAL: 3 };

export function planNotifications(candidates: AlertCandidate[], state: NotificationState, opts: NotificationOptions = {}): NotificationPlan {
  const floor = opts.floor ?? 'ATTENTION';
  const cooldown = opts.cooldownMs ?? 12 * 3600_000; // 12h default
  const now = opts.now ?? Date.now();
  const toSend: AlertCandidate[] = [];
  const suppressed: NotificationPlan['suppressed'] = [];
  const seen = new Set<string>();

  // Highest severity first so, among duplicates, the most severe representative is the one kept.
  const ordered = [...candidates].sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));
  for (const c of ordered) {
    if ((RANK[c.severity] ?? 0) < (RANK[floor] ?? 0)) { suppressed.push({ key: c.key, reason: 'below_floor' }); continue; }
    if (seen.has(c.key)) { suppressed.push({ key: c.key, reason: 'duplicate' }); continue; }
    seen.add(c.key);
    const last = state.lastSentAt[c.key];
    if (last != null && now - last < cooldown) { suppressed.push({ key: c.key, reason: 'cooldown' }); continue; }
    toSend.push(c);
  }
  return { toSend, suppressed };
}

/** Apply a plan to the state (pure) so the next run honors the cooldown. */
export function applyPlan(state: NotificationState, plan: NotificationPlan, now = Date.now()): NotificationState {
  const lastSentAt = { ...state.lastSentAt };
  for (const c of plan.toSend) lastSentAt[c.key] = now;
  return { lastSentAt };
}
