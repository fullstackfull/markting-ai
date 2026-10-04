import { requirePlatformOperator } from '@/lib/platform/auth';
import { listIncidents, incidentSummary, recentAlerts } from '@/lib/platform/incident-reads';
import { AdminActionForm } from '@/components/admin/action-form';
import { createIncidentAction, transitionIncidentAction, assignIncidentAction, addIncidentNoteAction } from '@/lib/platform/incident-actions';
import { LEGAL_TRANSITIONS, type IncidentState } from '@/lib/markting/ops/incidents';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incidents' };

const tone = (state: string) => state === 'RESOLVED' ? 'ok' : state === 'OPEN' || state === 'POSTMORTEM_REQUIRED' ? 'bad' : 'warn';

/**
 * PHASE C.5 (5) — Platform Admin incident operations. Operators inspect, acknowledge, assign, update
 * status, and resolve incidents; every mutation is role-gated + reason-required + audited server-side.
 * Tenants cannot reach this plane (the /admin tree returns notFound() to non-operators, and the
 * incident tables have no tenant read policy).
 */
export default async function AdminIncidentsPage() {
  const operator = await requirePlatformOperator();
  const [incidents, summary, alerts] = await Promise.all([listIncidents(), incidentSummary(), recentAlerts()]);
  const canMutate = operator.role !== 'READ_ONLY_AUDITOR';

  return (
    <>
      <div className="admin-card">
        <h2>Incident summary</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {([['Open', summary.open], ['Acknowledged', summary.acknowledged], ['Investigating', summary.investigating], ['Mitigated', summary.mitigated], ['Resolved', summary.resolved], ['Postmortem', summary.postmortem], ['Critical open', summary.critical_open]] as const).map(([label, n]) => (
            <div key={label} style={{ minWidth: 92 }}><div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{n}</div><span className="admin-note">{label}</span></div>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <h2>Recent alerts</h2>
        <p className="admin-note">Deduplicated alert instances (markting_alerts). Delivery is the Platform-Admin channel; external channels are optional adapters. No alert storms — repeats within cooldown bump count, not delivery.</p>
        {alerts.length === 0 ? <p className="admin-note">No alerts.</p> : (
          <table className="admin-table"><thead><tr><th>Type</th><th>Severity</th><th>Provider</th><th>State</th><th>Count</th><th>Last seen</th><th>Incident</th></tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.id}><td>{a.alert_type}</td><td><span className={`admin-tag ${a.severity === 'CRITICAL' ? 'bad' : 'warn'}`}>{a.severity}</span></td><td>{a.provider ?? '—'}</td><td>{a.state}</td><td>{a.count}</td><td>{new Date(a.last_seen_at).toISOString().slice(0, 19).replace('T', ' ')}</td><td>{a.incident_id ? 'linked' : '—'}</td></tr>
            ))}</tbody></table>
        )}
      </div>

      {canMutate && (
        <div className="admin-card">
          <h2>Open a new incident</h2>
          <AdminActionForm action={createIncidentAction} submitLabel="Open incident">
            <label className="admin-note">Title<input name="title" required minLength={3} style={{ display: 'block', width: '100%', marginTop: '0.3rem' }} /></label>
            <label className="admin-note">Severity
              <select name="severity" defaultValue="WARNING" style={{ display: 'block', marginTop: '0.3rem' }}>
                <option>INFO</option><option>WARNING</option><option>CRITICAL</option>
              </select>
            </label>
          </AdminActionForm>
        </div>
      )}

      <div className="admin-card">
        <h2>Incidents</h2>
        {incidents.length === 0 ? <p className="admin-note">No incidents.</p> : incidents.map((i) => (
          <div key={i.id} style={{ borderTop: '1px solid var(--admin-border, #333)', paddingTop: 10, marginTop: 10 }}>
            <div className="admin-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong>{i.title}</strong>
              <span className={`admin-tag ${tone(i.state)}`}>{i.state}</span>
              <span className={`admin-tag ${i.severity === 'CRITICAL' ? 'bad' : 'warn'}`}>{i.severity}</span>
            </div>
            <p className="admin-note">id {i.id} · started {new Date(i.startedAtMs).toISOString().slice(0, 19).replace('T', ' ')} · owner {i.ownerOperatorId ?? 'unassigned'} · providers {i.affectedProviders.join(', ') || '—'}</p>
            {i.timeline.length > 0 && (
              <details><summary className="admin-note">Timeline ({i.timeline.length})</summary>
                <ul className="admin-note">{i.timeline.map((t, idx) => <li key={idx}>{new Date(t.at).toISOString().slice(0, 19).replace('T', ' ')} — {t.from}→{t.to} by {t.actor}: {t.reason}</li>)}</ul>
              </details>
            )}
            {canMutate && i.state !== 'RESOLVED' && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                <AdminActionForm action={transitionIncidentAction} submitLabel="Update status" hidden={{ incidentId: i.id! }}>
                  <label className="admin-note">To state
                    <select name="to" style={{ display: 'block', marginTop: '0.3rem' }}>
                      {LEGAL_TRANSITIONS[i.state as IncidentState].map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="admin-note">Resolution (required to resolve)<input name="resolution" style={{ display: 'block', width: '100%', marginTop: '0.3rem' }} /></label>
                </AdminActionForm>
                <AdminActionForm action={assignIncidentAction} submitLabel="Assign owner" hidden={{ incidentId: i.id! }}>
                  <label className="admin-note">Owner operator id (uuid)<input name="ownerOperatorId" style={{ display: 'block', width: '100%', marginTop: '0.3rem' }} /></label>
                </AdminActionForm>
                <AdminActionForm action={addIncidentNoteAction} submitLabel="Add note" hidden={{ incidentId: i.id! }}>
                  <label className="admin-note">Note<input name="note" style={{ display: 'block', width: '100%', marginTop: '0.3rem' }} /></label>
                </AdminActionForm>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
