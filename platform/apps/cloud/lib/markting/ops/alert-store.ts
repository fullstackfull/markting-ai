import 'server-only';
import { db } from '@/lib/db';
import type { AlertRecord } from './alerts';
import type { AlertStore } from './alert-delivery';

/** In-memory alert store for unit tests. */
export class InMemoryAlertStore implements AlertStore {
  private byKey = new Map<string, AlertRecord>();
  async findByDedupKey(key: string): Promise<AlertRecord | null> { return this.byKey.get(key) ?? null; }
  async upsert(record: AlertRecord): Promise<AlertRecord> {
    const saved = { ...record, id: record.id ?? record.dedupKey };
    this.byKey.set(record.dedupKey, saved);
    return saved;
  }
  all(): AlertRecord[] { return [...this.byKey.values()]; }
}

// db() applies postgres.camel.column, so reads come back camelCased.
type Row = {
  id: string; alertType: AlertRecord['type']; severity: AlertRecord['severity']; source: string;
  organizationId: string | null; provider: string | null; dedupKey: string; correlationId: string;
  state: AlertRecord['state']; count: number; evidence: Record<string, unknown> | string;
  firstSeenAt: Date | string; lastSeenAt: Date | string; cooldownUntil: Date | string | null; incidentId: string | null;
};
const ms = (v: Date | string | null | undefined): number => (v == null ? NaN : new Date(v).getTime());
function parseEvidence(v: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return v;
}
function rowTo(r: Row): AlertRecord {
  return {
    id: r.id, type: r.alertType, severity: r.severity, source: r.source,
    organizationId: r.organizationId, provider: r.provider, dedupKey: r.dedupKey, correlationId: r.correlationId,
    state: r.state, count: r.count, evidence: parseEvidence(r.evidence),
    firstSeenAtMs: ms(r.firstSeenAt), lastSeenAtMs: ms(r.lastSeenAt),
    cooldownUntilMs: r.cooldownUntil == null ? null : ms(r.cooldownUntil), incidentId: r.incidentId,
  };
}

/** Postgres alert store over public.markting_alerts (upsert on dedup_key). */
export class PostgresAlertStore implements AlertStore {
  async findByDedupKey(key: string): Promise<AlertRecord | null> {
    const rows = await db()<Row[]>`select * from public.markting_alerts where dedup_key = ${key} limit 1`;
    return rows[0] ? rowTo(rows[0]) : null;
  }
  async upsert(record: AlertRecord): Promise<AlertRecord> {
    const rows = await db()<Row[]>`
      insert into public.markting_alerts
        (alert_type, severity, source, organization_id, provider, dedup_key, correlation_id, state, count,
         evidence, first_seen_at, last_seen_at, cooldown_until, incident_id)
      values (${record.type}, ${record.severity}, ${record.source}, ${record.organizationId}, ${record.provider},
              ${record.dedupKey}, ${record.correlationId}, ${record.state}, ${record.count},
              ${JSON.stringify(record.evidence)}::jsonb, ${new Date(record.firstSeenAtMs)},
              ${new Date(record.lastSeenAtMs)},
              ${record.cooldownUntilMs == null ? null : new Date(record.cooldownUntilMs)},
              ${record.incidentId})
      on conflict (dedup_key) do update set
        severity = excluded.severity, state = excluded.state, count = excluded.count,
        evidence = excluded.evidence, last_seen_at = excluded.last_seen_at,
        cooldown_until = excluded.cooldown_until, correlation_id = excluded.correlation_id,
        incident_id = coalesce(public.markting_alerts.incident_id, excluded.incident_id),
        updated_at = now()
      returning *
    `;
    return rowTo(rows[0]!);
  }
}
