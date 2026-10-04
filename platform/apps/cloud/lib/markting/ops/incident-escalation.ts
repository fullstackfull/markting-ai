import 'server-only';
import type { AlertSeverity } from './alerts';
import type { Incident, IncidentSeverity } from './incidents';

/**
 * PHASE C.6 (item 20) — deterministic INCIDENT ESCALATION POLICY.
 *
 * A pure, credential-free model: map an alert/incident severity onto a SEV level, look up the fixed SLA /
 * timer / owning-role policy for that level, and decide — over an INJECTED clock — whether an
 * unacknowledged incident has breached its acknowledgement SLA and must escalate.
 *
 * There is NO external pager here. Turning an escalation decision into an actual page is the on-call
 * resolver's job (oncall.ts) + a deploy-time transport; this file only computes the deterministic policy.
 */

export type SevLevel = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

/** Severity unions in alerts.ts and incidents.ts are identical ('INFO' | 'WARNING' | 'CRITICAL'). */
type Severity = AlertSeverity | IncidentSeverity;

/** Deterministic severity → SEV mapping. Unknown values fall back to the lowest level (SEV4). */
export function sevForSeverity(severity: Severity): SevLevel {
  switch (severity) {
    case 'CRITICAL':
      return 'SEV1';
    case 'WARNING':
      return 'SEV2';
    case 'INFO':
      return 'SEV3';
    default:
      return 'SEV4';
  }
}

export interface EscalationPolicy {
  sev: SevLevel;
  /** Minutes an incident may stay unacknowledged before it breaches and should escalate. */
  acknowledgementSlaMinutes: number;
  /** Minutes between successive escalation steps once engaged. */
  escalationTimerMinutes: number;
  /** The operator role that owns an incident at this level. */
  operatorRole: string;
}

/** The fixed policy table — deterministic and the single source of truth for SLAs/timers/roles. */
export const ESCALATION_POLICY: Record<SevLevel, EscalationPolicy> = {
  SEV1: { sev: 'SEV1', acknowledgementSlaMinutes: 5, escalationTimerMinutes: 15, operatorRole: 'incident_commander' },
  SEV2: { sev: 'SEV2', acknowledgementSlaMinutes: 15, escalationTimerMinutes: 30, operatorRole: 'senior_operator' },
  SEV3: { sev: 'SEV3', acknowledgementSlaMinutes: 60, escalationTimerMinutes: 120, operatorRole: 'operator' },
  SEV4: { sev: 'SEV4', acknowledgementSlaMinutes: 240, escalationTimerMinutes: 480, operatorRole: 'operator' },
};

/** Pure lookup: the policy for a SEV level. */
export function escalationFor(sev: SevLevel): EscalationPolicy {
  return ESCALATION_POLICY[sev];
}

export interface EscalationDecision {
  /** True when the incident is unacknowledged and has breached its acknowledgement SLA. */
  shouldEscalate: boolean;
  /** The SEV level the incident's severity maps to (the "breached level" when escalating). */
  sev: SevLevel;
  /** The SLA (minutes) that was evaluated. */
  slaMinutes: number;
  /** How long (minutes) the incident has been open since detection, per the injected clock. */
  elapsedMinutes: number;
  /** The role to escalate to, or null when no escalation is due. */
  targetRole: string | null;
}

/**
 * Pure escalation decision over an injected clock. An incident counts as handled once it is
 * acknowledged (acknowledgedAtMs set) or has moved past OPEN; otherwise, once the elapsed time since
 * detection reaches the SEV's acknowledgement SLA, it has breached and should escalate to the SEV's
 * owning role. Does not mutate the incident and reads no wall clock of its own.
 */
export function nextEscalation(incident: Incident, now: number): EscalationDecision {
  const sev = sevForSeverity(incident.severity);
  const policy = escalationFor(sev);
  const handled = incident.acknowledgedAtMs != null || incident.state !== 'OPEN';
  const elapsedMinutes = Math.max(0, now - incident.detectedAtMs) / 60_000;
  const shouldEscalate = !handled && elapsedMinutes >= policy.acknowledgementSlaMinutes;
  return {
    shouldEscalate,
    sev,
    slaMinutes: policy.acknowledgementSlaMinutes,
    elapsedMinutes,
    targetRole: shouldEscalate ? policy.operatorRole : null,
  };
}
