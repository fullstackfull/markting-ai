import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { providerDetail } from '@/lib/connections/platform-read';
import { AdminActionForm } from '@/components/admin/action-form';
import { forceHealthRecheck, requestReauthorization, disableConnection, enableConnection } from '@/lib/connections/platform-actions';

export const dynamic = 'force-dynamic';

export default async function AdminProviderDetailPage({ params }: { params: Promise<{ provider: string }> }) {
  await requirePlatformOperator();
  const { provider } = await params;
  const d = await providerDetail(provider);
  const reg = d.registry;
  return (
    <>
      <p className="admin-note"><Link className="inline-link" href="/admin/integrations">← Integration fleet</Link></p>
      <div className="admin-card">
        <h2>{d.label}</h2>
        <p className="admin-note">{d.organizations} organization(s) · {d.accounts} discovered account(s)</p>
        {reg ? (
          <p className="admin-note">
            Category {reg.category} · Auth {reg.authType} · Live transport {reg.liveTransportImplemented ? 'yes' : 'BLOCKED_EXTERNAL'} ·
            Refresh {reg.capabilities.refresh ? 'yes' : 'no'} · Revoke {reg.capabilities.revokeProviderSide ? 'server-side' : 'manual'} ·
            Permission discovery {reg.capabilities.permissionDiscovery}
            {reg.notes ? ` · ${reg.notes}` : ''}
          </p>
        ) : null}
        <p className="admin-note">Status: {d.byStatus.map((s) => `${s.status}:${s.n}`).join(' · ') || '—'} | Health: {d.byHealth.map((s) => `${s.state}:${s.n}`).join(' · ') || '—'} | Errors: {d.byErrorClass.map((s) => `${s.errorClass}:${s.n}`).join(' · ') || 'none'}</p>
      </div>

      <div className="admin-card">
        <h2>Connections ({d.connections.length})</h2>
        <p className="admin-note">No tokens/secrets are shown. Safe operator actions only — no plaintext credential replacement exists.</p>
        {d.connections.length === 0 ? <p className="admin-note">No connections for this provider.</p> : (
          <table className="admin-table">
            <thead><tr><th>Organization</th><th>Status</th><th>Health</th><th>Error</th><th>Reauth</th><th>Expiry</th><th>Detail</th></tr></thead>
            <tbody>{d.connections.map((c) => (
              <tr key={c.connectionId}>
                <td>{c.orgName}</td>
                <td><span className={`admin-tag ${c.status === 'connected' ? 'ok' : c.status === 'revoked' ? 'bad' : 'warn'}`}>{c.status}</span></td>
                <td>{c.healthState ?? '—'}</td>
                <td>{c.errorClassification ?? '—'}</td>
                <td>{c.reauthRequired ? 'yes' : '—'}</td>
                <td>{c.tokenExpiresAt ? new Date(c.tokenExpiresAt).toISOString().slice(0, 10) : '—'}{c.disabledAt ? ' · DISABLED' : ''}</td>
                <td><Link className="inline-link" href={`/admin/integrations/connection/${c.connectionId}`}>Open →</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h2>Bulk-safe actions</h2>
        <p className="admin-note">Per-connection actions live on each connection's detail page. These operate on a connection id you paste below (audited, reason required).</p>
        <div className="admin-actions-grid">
          <div><h3 style={{ fontSize: '0.8rem' }}>Force health recheck</h3><AdminActionForm action={forceHealthRecheck} submitLabel="Recompute health"><ConnInput /></AdminActionForm></div>
          <div><h3 style={{ fontSize: '0.8rem' }}>Request reauthorization</h3><AdminActionForm action={requestReauthorization} submitLabel="Request reauth"><ConnInput /></AdminActionForm></div>
          <div><h3 style={{ fontSize: '0.8rem' }}>Disable connection</h3><AdminActionForm action={disableConnection} submitLabel="Disable" danger><ConnInput /></AdminActionForm></div>
          <div><h3 style={{ fontSize: '0.8rem' }}>Re-enable connection</h3><AdminActionForm action={enableConnection} submitLabel="Re-enable"><ConnInput /></AdminActionForm></div>
        </div>
      </div>
    </>
  );
}

function ConnInput() {
  return <input name="connectionId" required placeholder="connection id (uuid)" className="admin-input" aria-label="Connection id" />;
}
