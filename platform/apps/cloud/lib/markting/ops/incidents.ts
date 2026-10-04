import 'server-only';

/**
 * PHASE C.5 (5) — INCIDENT workflow. A legal-transition state machine with an append-only timeline.
 * Pure: `transitionIncident` validates the move, requires a reason, stamps the lifecycle timestamps, and
 * appends a timeline entry. Persistence (incident-store.ts) and the operator UI (/admin/incidents) sit on
 * top; every mutation there is role-gated, reason-required, and audited.
 */

export const INCIDENT_STATES = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATED', 'RESOLVED', 'POSTMORTEM_REQUIRED'] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];
export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/** Legal forward transitions. Resolution may require a postmortem; a postmortem closes to RESOLVED. */
export const LEGAL_TRANSITIONS: Record<IncidentState, IncidentState[]> = {
  OPEN: ['ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'],
  ACKNOWLEDGED: ['INVESTIGATING', 'MITIGATED', 'RESOLVED'],
  INVESTIGATING: ['MITIGATED', 'RESOLVED', 'POSTMORTEM_REQUIRED'],
  MITIGATED: ['RESOLVED', 'POSTMORTEM_REQUIRED'],
  RESOLVED: ['POSTMORTEM_REQUIRED'],       // a resolved incident can still be flagged for postmortem
  POSTMORTEM_REQUIRED: ['RESOLVED'],        // postmortem completed → resolved
};

export interface TimelineEntry {
  at: number;
  actor: string;
  from: IncidentState;
  to: IncidentState;
  reason: string;
}

export interface Incident {
  id?: string;
  title: string;
  severity: IncidentSeverity;
  source: string;
  state: IncidentState;
  affectedOrganizations: string[];
  affectedProviders: string[];
  correlationId: string | null;
  ownerOperatorId: string | null;
  startedAtMs: number;
  detectedAtMs: number;
  acknowledgedAtMs: number | null;
  resolvedAtMs: number | null;
  timeline: TimelineEntry[];
  notes: Array<{ at: number; actor: string; note: string }>;
  resolution: string | null;
}

export class IllegalIncidentTransition extends Error {
  constructor(public readonly from: IncidentState, public readonly to: IncidentState) {
    super(`illegal incident transition ${from} → ${to}`);
    this.name = 'IllegalIncidentTransition';
  }
}

export function canTransition(from: IncidentState, to: IncidentState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export interface NewIncidentInput {
  title: string;
  severity: IncidentSeverity;
  source: string;
  affectedOrganizations?: string[];
  affectedProviders?: string[];
  correlationId?: string | null;
  now: number;
}

export function openIncident(input: NewIncidentInput): Incident {
  return {
    title: input.title, severity: input.severity, source: input.source, state: 'OPEN',
    affectedOrganizations: input.affectedOrganizations ?? [], affectedProviders: input.affectedProviders ?? [],
    correlationId: input.correlationId ?? null, ownerOperatorId: null,
    startedAtMs: input.now, detectedAtMs: input.now, acknowledgedAtMs: null, resolvedAtMs: null,
    timeline: [], notes: [], resolution: null,
  };
}

export interface TransitionInput {
  to: IncidentState;
  actor: string;       // operator id
  reason: string;      // required — a reasonless transition is rejected
  now: number;
  resolution?: string; // required message when moving to RESOLVED
}

/** Apply a legal, reason-bearing transition; returns the next incident (does not mutate the input). */
export function transitionIncident(incident: Incident, input: TransitionInput): Incident {
  if (!input.reason || !input.reason.trim()) throw new Error('a transition reason is required');
  if (!canTransition(incident.state, input.to)) throw new IllegalIncidentTransition(incident.state, input.to);
  if (input.to === 'RESOLVED' && !(input.resolution && input.resolution.trim())) {
    throw new Error('resolving an incident requires a resolution note');
  }
  const entry: TimelineEntry = { at: input.now, actor: input.actor, from: incident.state, to: input.to, reason: input.reason };
  return {
    ...incident,
    state: input.to,
    acknowledgedAtMs: input.to === 'ACKNOWLEDGED' && incident.acknowledgedAtMs == null ? input.now : incident.acknowledgedAtMs,
    resolvedAtMs: input.to === 'RESOLVED' ? input.now : incident.resolvedAtMs,
    resolution: input.to === 'RESOLVED' ? (input.resolution ?? incident.resolution) : incident.resolution,
    timeline: [...incident.timeline, entry],
  };
}

export function assignOwner(incident: Incident, operatorId: string, now: number, actor: string): Incident {
  return {
    ...incident,
    ownerOperatorId: operatorId,
    timeline: [...incident.timeline, { at: now, actor, from: incident.state, to: incident.state, reason: `assigned to ${operatorId}` }],
  };
}

export function addNote(incident: Incident, note: string, actor: string, now: number): Incident {
  return { ...incident, notes: [...incident.notes, { at: now, actor, note }] };
}
