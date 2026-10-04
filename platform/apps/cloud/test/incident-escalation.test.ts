import { describe, expect, it } from 'vitest';
import { openIncident, transitionIncident, type Incident } from '@/lib/markting/ops/incidents';
import {
  sevForSeverity,
  escalationFor,
  nextEscalation,
  ESCALATION_POLICY,
} from '@/lib/markting/ops/incident-escalation';

const NOW = 5_000_000;

const openAt = (severity: Incident['severity'], now = NOW): Incident =>
  openIncident({ title: 't', severity, source: 'sync-worker', now });

describe('C.6-20 — incident escalation policy', () => {
  it('maps severity deterministically onto SEV levels', () => {
    expect(sevForSeverity('CRITICAL')).toBe('SEV1');
    expect(sevForSeverity('WARNING')).toBe('SEV2');
    expect(sevForSeverity('INFO')).toBe('SEV3');
  });

  it('exposes a fixed SLA / timer / role table per SEV', () => {
    expect(escalationFor('SEV1')).toEqual({ sev: 'SEV1', acknowledgementSlaMinutes: 5, escalationTimerMinutes: 15, operatorRole: 'incident_commander' });
    expect(escalationFor('SEV2').acknowledgementSlaMinutes).toBe(15);
    expect(escalationFor('SEV3').operatorRole).toBe('operator');
    expect(escalationFor('SEV4').acknowledgementSlaMinutes).toBe(240);
    // the table covers all four SEV levels
    expect(Object.keys(ESCALATION_POLICY)).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
  });

  it('does not escalate before the SLA elapses', () => {
    const inc = openAt('CRITICAL'); // SEV1 → 5 min SLA
    const d = nextEscalation(inc, NOW + 4 * 60_000);
    expect(d.shouldEscalate).toBe(false);
    expect(d.sev).toBe('SEV1');
    expect(d.targetRole).toBeNull();
  });

  it('escalates once an unacknowledged incident breaches its SLA (injected clock)', () => {
    const inc = openAt('CRITICAL'); // SEV1 → 5 min SLA, commander role
    const d = nextEscalation(inc, NOW + 5 * 60_000);
    expect(d.shouldEscalate).toBe(true);
    expect(d.sev).toBe('SEV1');
    expect(d.slaMinutes).toBe(5);
    expect(d.targetRole).toBe('incident_commander');
    expect(d.elapsedMinutes).toBe(5);
  });

  it('a WARNING (SEV2) escalates to the senior operator after its longer SLA', () => {
    const inc = openAt('WARNING'); // SEV2 → 15 min SLA
    expect(nextEscalation(inc, NOW + 14 * 60_000).shouldEscalate).toBe(false);
    const d = nextEscalation(inc, NOW + 15 * 60_000);
    expect(d.shouldEscalate).toBe(true);
    expect(d.targetRole).toBe('senior_operator');
  });

  it('does not escalate once the incident is acknowledged, even past the SLA', () => {
    let inc = openAt('CRITICAL');
    inc = transitionIncident(inc, { to: 'ACKNOWLEDGED', actor: 'op1', reason: 'on it', now: NOW + 1000 });
    const d = nextEscalation(inc, NOW + 60 * 60_000);
    expect(d.shouldEscalate).toBe(false);
    expect(d.targetRole).toBeNull();
  });

  it('does not escalate once the incident has moved past OPEN (handled)', () => {
    let inc = openAt('CRITICAL');
    inc = transitionIncident(inc, { to: 'INVESTIGATING', actor: 'op1', reason: 'digging in', now: NOW + 1000 });
    expect(nextEscalation(inc, NOW + 60 * 60_000).shouldEscalate).toBe(false);
  });
});
