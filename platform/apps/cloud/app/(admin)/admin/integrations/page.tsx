import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { fleetOverview, detectConnectionIncidents, connectionSecurityCenter, registryCatalog } from '@/lib/connections/platform-read';
import { AdminActionForm } from '@/components/admin/action-form';
import { scanConnectionIncidents } from '@/lib/connections/platform-actions';

export const dynamic = 'force-dynamic';

/**
 * Super Admin — Integration Operations Center. Fleet-level connection health, provider breakdown,
 * deterministic incident detection, a connection security center, and the provider capability catalog.
 * Cross-tenant reads run through the SELECT-only adport_platform_admin role; NO secrets are shown.
 */
export default async function AdminIntegrationsPage() {
  await requirePlatformOperator();
  const [overview, incidents, security, catalog] = await Promise.all([
    fleetOverview(),
    detectConnectionIncidents(),
    connectionSecurityCenter(),
    Promise.resolve(registryCatalog()),
  ]);
  const t = overview.totals;
  return (
    <>
      <div className="admin-card">
        <h2>Integration fleet overview</h2>
        <p className="admin-note">Cross-tenant rollup of the canonical connection model. One shared status/health vocabulary with the tenant Connection Center. No tokens/secrets.</p>
        <div className="admin-kpis">
          <Kpi label="Total" value={t.total} />
          <Kpi label="Connected" value={t.connected} tone="ok" />
          <Kpi label="Error" value={t.error} tone={t.error ? 'bad' : undefined} />
          <Kpi label="Revoked" value={t.revoked} />
          <Kpi label="Disabled" value={t.disabled} tone={t.disabled ? 'bad' : undefined} />
          <Kpi label="Reauth required" value={t.reauthRequired} tone={t.reauthRequired ? 'warn' : undefined} />
          <Kpi label="Expiring ≤7d" value={t.expiringSoon} tone={t.expiringSoon ? 'warn' : undefined} />
          <Kpi label="Commerce stores" value={overview.commerce.total} />
        </div>
      </div>

      <div className="admin-card">
        <h2>By provider</h2>
        {overview.byProvider.length === 0 ? <p className="admin-note">No connections.</p> : (
          <table className="admin-table"><thead><tr><th>Provider</th><th>Total</th><th>Connected</th><th>Error</th><th>Revoked</th><th>Disabled</th><th></th></tr></thead>
            <tbody>{overview.byProvider.map((p) => (
              <tr key={p.provider}>
                <td>{p.label}</td><td>{p.total}</td>
                <td><span className="admin-tag ok">{p.connected}</span></td>
                <td>{p.error ? <span className="admin-tag bad">{p.error}</span> : p.error}</td>
                <td>{p.revoked}</td><td>{p.disabled ? <span className="admin-tag bad">{p.disabled}</span> : p.disabled}</td>
                <td><Link className="inline-link" href={`/admin/integrations/${p.provider}`}>Inspect →</Link></td>
              </tr>
            ))}</tbody></table>
        )}
        <p className="admin-note">Status breakdown: {overview.byStatus.map((s) => `${s.status}:${s.n}`).join(' · ') || '—'}</p>
        <p className="admin-note">Error classes: {overview.byErrorClass.map((s) => `${s.errorClass}:${s.n}`).join(' · ') || 'none'}</p>
      </div>

      <div className="admin-card">
        <h2>Incident detection (deterministic)</h2>
        <p className="admin-note">Threshold-based rollups — never an LLM. Publish to the notifications inbox to track them.</p>
        {incidents.length === 0 ? <p className="admin-note">No active incidents above threshold.</p> : (
          <ul className="admin-list">{incidents.map((i) => (
            <li key={i.dedupeKey}><span className={`admin-tag ${i.severity === 'critical' ? 'bad' : 'warn'}`}>{i.severity}</span> <strong>{i.title}</strong> — {i.detail}</li>
          ))}</ul>
        )}
        <AdminActionForm action={scanConnectionIncidents} submitLabel="Scan & publish incidents" />
      </div>

      <div className="admin-card">
        <h2>Connection Security Center</h2>
        <SecurityList title="Expiring credentials (≤14d)" rows={security.expiring.map((r) => `${r.orgName} · ${r.provider} · ${r.tokenExpiresAt ? new Date(r.tokenExpiresAt).toISOString().slice(0, 10) : '—'}`)} />
        <SecurityList title="Revoked" rows={security.revoked.map((r) => `${r.orgName} · ${r.provider}`)} />
        <SecurityList title="Repeated auth failures" rows={security.authFailing.map((r) => `${r.orgName} · ${r.provider} · ${r.errorClassification ?? ''}`)} />
        <SecurityList title="Insufficient permissions" rows={security.insufficientScopes.map((r) => `${r.orgName} · ${r.provider}`)} />
        <SecurityList title="Disabled by operator" rows={security.disabled.map((r) => `${r.orgName} · ${r.provider}${r.disabledReason ? ` · ${r.disabledReason}` : ''}`)} />
      </div>

      <div className="admin-card">
        <h2>Provider capability catalog</h2>
        <p className="admin-note">The single capability registry. "Live" = adapter makes real authenticated calls; commerce live transport is BLOCKED_EXTERNAL.</p>
        <table className="admin-table"><thead><tr><th>Integration</th><th>Category</th><th>Auth</th><th>Live</th><th>Refresh</th><th>Revoke</th><th>Webhook</th><th>Sync</th></tr></thead>
          <tbody>{catalog.map((e) => (
            <tr key={e.id}>
              <td>{e.label}</td><td>{e.category}</td><td>{e.authType}</td>
              <td>{e.liveTransportImplemented ? <span className="admin-tag ok">live</span> : <span className="admin-tag warn">blocked_ext</span>}</td>
              <td>{e.capabilities.refresh ? 'yes' : '—'}</td>
              <td>{e.capabilities.revokeProviderSide ? 'server' : 'manual'}</td>
              <td>{e.capabilities.webhook ? 'yes' : '—'}</td>
              <td>{e.capabilities.sync ? 'engine' : '—'}</td>
            </tr>
          ))}</tbody></table>
      </div>

      <div className="admin-card">
        <h2>Connection search</h2>
        <form action="/admin/integrations/search" method="get" className="admin-form">
          <input name="q" placeholder="provider / ad account / org / store / stripe id" className="admin-input" aria-label="Connection search" />
          <button className="admin-btn" type="submit">Search</button>
        </form>
      </div>
    </>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? '#ff9a8a' : tone === 'warn' ? '#ffcf7a' : tone === 'ok' ? '#7ee0a6' : undefined;
  return <div className="admin-kpi"><span className="label">{label}</span><span className="value" style={color ? { color } : undefined}>{value}</span></div>;
}

function SecurityList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div style={{ marginTop: '0.5rem' }}>
      <h3 style={{ fontSize: '0.8rem', margin: '0 0 0.2rem' }}>{title} <span className="admin-note">({rows.length})</span></h3>
      {rows.length === 0 ? <p className="admin-note">none</p> : <ul className="admin-list">{rows.slice(0, 25).map((r, i) => <li key={i}>{r}</li>)}</ul>}
    </div>
  );
}
