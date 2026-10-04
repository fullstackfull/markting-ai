import 'server-only';
import { db } from '@/lib/db';
import type { Incident, IncidentState } from './incidents';

// db() applies postgres.camel.column, so reads come back camelCased.
type Row = {
  id: string; title: string; severity: Incident['severity']; source: string; state: IncidentState;
  affectedOrganizations: string[]; affectedProviders: string[]; correlationId: string | null;
  ownerOperatorId: string | null; startedAt: Date | string; detectedAt: Date | string;
  acknowledgedAt: Date | string | null; resolvedAt: Date | string | null; timeline: Incident['timeline'] | string;
  notes: Incident['notes'] | string; resolution: string | null;
};
const ms = (v: Date | string): number => new Date(v).getTime();
function asArr<T>(v: T[] | string | null | undefined): T[] {
  if (v == null) return [];
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return v;
}
function rowTo(r: Row): Incident {
  return {
    id: r.id, title: r.title, severity: r.severity, source: r.source, state: r.state,
    affectedOrganizations: r.affectedOrganizations ?? [], affectedProviders: r.affectedProviders ?? [],
    correlationId: r.correlationId, ownerOperatorId: r.ownerOperatorId,
    startedAtMs: ms(r.startedAt), detectedAtMs: ms(r.detectedAt),
    acknowledgedAtMs: r.acknowledgedAt == null ? null : ms(r.acknowledgedAt),
    resolvedAtMs: r.resolvedAt == null ? null : ms(r.resolvedAt),
    timeline: asArr(r.timeline), notes: asArr(r.notes), resolution: r.resolution,
  };
}

/** Postgres incident store over public.markting_incidents. */
export class PostgresIncidentStore {
  async create(incident: Incident): Promise<Incident> {
    const rows = await db()<Row[]>`
      insert into public.markting_incidents
        (title, severity, source, state, affected_organizations, affected_providers, correlation_id,
         owner_operator_id, started_at, detected_at, timeline, notes, resolution)
      values (${incident.title}, ${incident.severity}, ${incident.source}, ${incident.state},
              ${incident.affectedOrganizations}, ${incident.affectedProviders}, ${incident.correlationId},
              ${incident.ownerOperatorId}, ${new Date(incident.startedAtMs)},
              ${new Date(incident.detectedAtMs)}, ${JSON.stringify(incident.timeline)}::jsonb,
              ${JSON.stringify(incident.notes)}::jsonb, ${incident.resolution})
      returning *
    `;
    return rowTo(rows[0]!);
  }

  async get(id: string): Promise<Incident | null> {
    const rows = await db()<Row[]>`select * from public.markting_incidents where id = ${id} limit 1`;
    return rows[0] ? rowTo(rows[0]) : null;
  }

  async list(limit = 100): Promise<Incident[]> {
    const rows = await db()<Row[]>`select * from public.markting_incidents order by started_at desc limit ${limit}`;
    return rows.map(rowTo);
  }

  /** Persist a full incident state (the pure model computed the next value). id required. */
  async save(incident: Incident): Promise<Incident> {
    if (!incident.id) throw new Error('save requires an incident id');
    const rows = await db()<Row[]>`
      update public.markting_incidents set
        state = ${incident.state}, owner_operator_id = ${incident.ownerOperatorId},
        acknowledged_at = ${incident.acknowledgedAtMs == null ? null : new Date(incident.acknowledgedAtMs)},
        resolved_at = ${incident.resolvedAtMs == null ? null : new Date(incident.resolvedAtMs)},
        timeline = ${JSON.stringify(incident.timeline)}::jsonb, notes = ${JSON.stringify(incident.notes)}::jsonb,
        resolution = ${incident.resolution}, affected_organizations = ${incident.affectedOrganizations},
        affected_providers = ${incident.affectedProviders}, updated_at = now()
      where id = ${incident.id}
      returning *
    `;
    return rowTo(rows[0]!);
  }

  /** Link an alert to an incident (sets markting_alerts.incident_id). */
  async linkAlert(incidentId: string, alertId: string): Promise<void> {
    await db()`update public.markting_alerts set incident_id = ${incidentId}, updated_at = now() where id = ${alertId}`;
  }
}
