import 'server-only';
import { db } from '@/lib/db';
import { PostgresIncidentStore } from '@/lib/markting/ops/incident-store';
import type { Incident } from '@/lib/markting/ops/incidents';

/** Operator reads for the incident console. Backend role; the page gates on requirePlatformOperator. */
export async function listIncidents(limit = 100): Promise<Incident[]> {
  return new PostgresIncidentStore().list(limit);
}

export interface IncidentSummary { open: number; acknowledged: number; investigating: number; mitigated: number; resolved: number; postmortem: number; critical_open: number }

export async function incidentSummary(): Promise<IncidentSummary> {
  const rows = await db()<Array<{ state: string; severity: string; n: number }>>`
    select state, severity, count(*)::int as n from public.markting_incidents group by state, severity
  `;
  const s: IncidentSummary = { open: 0, acknowledged: 0, investigating: 0, mitigated: 0, resolved: 0, postmortem: 0, critical_open: 0 };
  for (const r of rows) {
    if (r.state === 'OPEN') s.open += r.n;
    else if (r.state === 'ACKNOWLEDGED') s.acknowledged += r.n;
    else if (r.state === 'INVESTIGATING') s.investigating += r.n;
    else if (r.state === 'MITIGATED') s.mitigated += r.n;
    else if (r.state === 'RESOLVED') s.resolved += r.n;
    else if (r.state === 'POSTMORTEM_REQUIRED') s.postmortem += r.n;
    if (r.severity === 'CRITICAL' && r.state !== 'RESOLVED') s.critical_open += r.n;
  }
  return s;
}

export interface AlertRow { id: string; alert_type: string; severity: string; source: string; provider: string | null; state: string; count: number; last_seen_at: string; incident_id: string | null }

export async function recentAlerts(limit = 50): Promise<AlertRow[]> {
  return db()<AlertRow[]>`
    select id, alert_type, severity, source, provider, state, count, last_seen_at, incident_id
    from public.markting_alerts order by last_seen_at desc limit ${limit}
  `;
}
