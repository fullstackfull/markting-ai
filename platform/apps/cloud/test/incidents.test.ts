import { describe, expect, it } from 'vitest';
import { openIncident, transitionIncident, canTransition, assignOwner, addNote, IllegalIncidentTransition, INCIDENT_STATES } from '@/lib/markting/ops/incidents';

const NOW = 4_000_000;
const base = () => openIncident({ title: 'Meta outage', severity: 'CRITICAL', source: 'sync-worker', correlationId: 'corr-1', now: NOW });

describe('C.5-5 — incident workflow', () => {
  it('opens in OPEN with lifecycle timestamps and empty timeline', () => {
    const i = base();
    expect(i.state).toBe('OPEN');
    expect(i.detectedAtMs).toBe(NOW);
    expect(i.timeline).toHaveLength(0);
    expect(INCIDENT_STATES).toContain('POSTMORTEM_REQUIRED');
  });

  it('a legal transition appends a timeline entry and stamps timestamps', () => {
    let i = base();
    i = transitionIncident(i, { to: 'ACKNOWLEDGED', actor: 'op1', reason: 'on it', now: NOW + 1000 });
    expect(i.state).toBe('ACKNOWLEDGED');
    expect(i.acknowledgedAtMs).toBe(NOW + 1000);
    expect(i.timeline.at(-1)).toMatchObject({ from: 'OPEN', to: 'ACKNOWLEDGED', actor: 'op1', reason: 'on it' });
  });

  it('an illegal transition throws', () => {
    const i = base(); // OPEN
    expect(() => transitionIncident(i, { to: 'MITIGATED', actor: 'op1', reason: 'x', now: NOW })).toThrow(IllegalIncidentTransition);
  });

  it('a transition requires a non-empty reason', () => {
    const i = base();
    expect(() => transitionIncident(i, { to: 'ACKNOWLEDGED', actor: 'op1', reason: '  ', now: NOW })).toThrow(/reason is required/);
  });

  it('resolving requires a resolution note', () => {
    const i = base();
    expect(() => transitionIncident(i, { to: 'RESOLVED', actor: 'op1', reason: 'done', now: NOW })).toThrow(/resolution/);
    const resolved = transitionIncident(i, { to: 'RESOLVED', actor: 'op1', reason: 'done', now: NOW, resolution: 'provider recovered' });
    expect(resolved.state).toBe('RESOLVED');
    expect(resolved.resolvedAtMs).toBe(NOW);
    expect(resolved.resolution).toBe('provider recovered');
  });

  it('full lifecycle OPEN→ACK→INVESTIGATING→MITIGATED→RESOLVED is legal; postmortem reachable', () => {
    expect(canTransition('OPEN', 'ACKNOWLEDGED')).toBe(true);
    expect(canTransition('ACKNOWLEDGED', 'INVESTIGATING')).toBe(true);
    expect(canTransition('INVESTIGATING', 'MITIGATED')).toBe(true);
    expect(canTransition('MITIGATED', 'RESOLVED')).toBe(true);
    expect(canTransition('RESOLVED', 'POSTMORTEM_REQUIRED')).toBe(true);
    expect(canTransition('POSTMORTEM_REQUIRED', 'RESOLVED')).toBe(true);
    expect(canTransition('OPEN', 'POSTMORTEM_REQUIRED')).toBe(false);
  });

  it('assignOwner + addNote record actor and preserve immutability', () => {
    const i = base();
    const assigned = assignOwner(i, 'op2', NOW + 10, 'op1');
    expect(assigned.ownerOperatorId).toBe('op2');
    expect(i.ownerOperatorId).toBeNull(); // original unchanged
    const noted = addNote(assigned, 'customer impact confirmed', 'op2', NOW + 20);
    expect(noted.notes.at(-1)).toMatchObject({ actor: 'op2', note: 'customer impact confirmed' });
  });
});
