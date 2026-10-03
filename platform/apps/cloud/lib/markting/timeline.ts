/**
 * Phase 3P/3Q — account/campaign change timeline + change-point context. Combines factual events
 * (recommendations, approvals, provider writes, human changes, tracking incidents, promotions,
 * performance shifts, outcomes, memory changes) into one ordered stream, and surfaces TEMPORAL
 * relationships around a performance shift. It never claims causality: a change shortly before a
 * deterioration is a TEMPORAL_ASSOCIATION, not a cause.
 */
import type { BiText } from './intelligence/decision-model';

export type TimelineEventType = 'recommendation' | 'approval' | 'provider_write' | 'human_change' | 'tracking_incident' | 'promotion' | 'performance_shift' | 'outcome' | 'memory_change';

export interface TimelineEvent {
  eventType: TimelineEventType;
  occurredAt: string;
  accountId: string;
  entityId?: string;
  source: string;
  summary: BiText;
  detail?: Record<string, unknown>;
}

/** Sort oldest→newest (stable). */
export function assembleTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

export interface ChangePoint {
  shiftAt: string;
  metric: string;
  direction: 'up' | 'down';
  /** Events within the lookback window BEFORE the shift — associations, not causes. */
  precedingChanges: TimelineEvent[];
  association: 'TEMPORAL_ASSOCIATION' | 'NONE';
  note: BiText;
}

const CHANGE_TYPES: ReadonlySet<TimelineEventType> = new Set(['provider_write', 'human_change', 'tracking_incident', 'promotion', 'approval']);

/**
 * Given a performance shift, find changes in the lookback window before it. Returns a
 * TEMPORAL_ASSOCIATION (never causation) when relevant changes precede the shift.
 */
export function changePointContext(timeline: TimelineEvent[], shift: { metric: string; at: string; direction: 'up' | 'down'; accountId: string; entityId?: string }, lookbackMs = 7 * 86_400_000): ChangePoint {
  const shiftMs = Date.parse(shift.at);
  const preceding = timeline.filter((e) =>
    CHANGE_TYPES.has(e.eventType) &&
    e.accountId === shift.accountId &&
    (!shift.entityId || !e.entityId || e.entityId === shift.entityId) &&
    Date.parse(e.occurredAt) <= shiftMs &&
    shiftMs - Date.parse(e.occurredAt) <= lookbackMs,
  ).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const association = preceding.length > 0 ? 'TEMPORAL_ASSOCIATION' : 'NONE';
  const kinds = [...new Set(preceding.map((e) => e.eventType))].join(', ');
  const note: BiText = association === 'TEMPORAL_ASSOCIATION'
    ? { en: `${shift.metric} moved ${shift.direction} shortly after: ${kinds}. This is a temporal association, not a proven cause.`, ar: `تحرّك ${shift.metric} ${shift.direction === 'up' ? 'صعودًا' : 'هبوطًا'} بُعيد: ${kinds}. هذا ارتباط زمني وليس سببًا مُثبتًا.` }
    : { en: `No recorded change precedes this ${shift.metric} shift within the lookback window.`, ar: `لا يوجد تغيير مُسجّل يسبق تحرّك ${shift.metric} ضمن نافذة النظر.` };
  return { shiftAt: shift.at, metric: shift.metric, direction: shift.direction, precedingChanges: preceding, association, note };
}
