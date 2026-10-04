import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { connectionDetail } from '@/lib/connections/platform-read';
import { AdminActionForm } from '@/components/admin/action-form';
import { forceHealthRecheck, requestReauthorization, disableConnection, enableConnection, retryConnectionSync } from '@/lib/connections/platform-actions';

export const dynamic = 'force-dynamic';

export default async function AdminConnectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformOperator();
  const { id } = await params;
  const d = await connectionDetail(id);
  if (!d) notFound();
  const reg = d.registry;
  const field = (k: string, v: unknown) => <div><dt>{k}</dt><dd>{v === null || v === undefined || v === '' ? '—' : String(v)}</dd></div>;
  return (
    <>
      <p className="admin-note"><Link className="inline-link" href={`/admin/integrations/${d.provider}`}>← {d.provider}</Link></p>
      <div className="admin-card">
        <h2>{d.orgName} · {d.provider}</h2>
        <p className="admin-note">Token/credential material is NEVER shown — only non-secret metadata below.</p>
        <dl className="connection-meta">
          {field('Status', d.status)}
          {field('Health', d.healthState)}
          {field('Error class', d.errorClassification)}
          {field('Connection type', d.connectionType)}
          {field('Auth type', d.authType)}
          {field('Environment', d.environment)}
          {field('Reauth required', d.reauthRequired ? 'yes' : 'no')}
          {field('Token expiry', d.tokenExpiresAt ? new Date(d.tokenExpiresAt).toISOString() : null)}
          {field('Last authenticated', d.lastAuthenticatedAt ? new Date(d.lastAuthenticatedAt).toISOString() : null)}
          {field('Last verified', d.lastVerifiedAt ? new Date(d.lastVerifiedAt).toISOString() : null)}
          {field('Last sync', d.lastSyncAt ? new Date(d.lastSyncAt).toISOString() : null)}
          {field('Disabled', d.disabledAt ? `yes — ${d.disabledReason ?? ''}` : 'no')}
          {field('Granted scopes', d.scopes?.length ?? 0)}
        </dl>
        {d.lastError ? <div className="error-callout" role="alert">{d.lastError}</div> : null}
        {reg ? <p className="admin-note">Capabilities: refresh {reg.capabilities.refresh ? 'yes' : 'no'} · revoke {reg.capabilities.revokeProviderSide ? 'server' : 'manual'} · sync {reg.capabilities.sync ? 'engine' : 'no'}</p> : null}
      </div>

      <div className="admin-card">
        <h2>Operator actions (audited, reason required)</h2>
        <div className="admin-actions-grid">
          <div><h3 style={{ fontSize: '0.8rem' }}>Force health recheck</h3><AdminActionForm action={forceHealthRecheck} submitLabel="Recompute health" hidden={{ connectionId: id }} /></div>
          <div><h3 style={{ fontSize: '0.8rem' }}>Request reauthorization</h3><AdminActionForm action={requestReauthorization} submitLabel="Request reauth" hidden={{ connectionId: id }} /></div>
          {d.disabledAt
            ? <div><h3 style={{ fontSize: '0.8rem' }}>Re-enable</h3><AdminActionForm action={enableConnection} submitLabel="Re-enable" hidden={{ connectionId: id }} /></div>
            : <div><h3 style={{ fontSize: '0.8rem' }}>Disable (fails closed)</h3><AdminActionForm action={disableConnection} submitLabel="Disable" danger hidden={{ connectionId: id }} /></div>}
          <div><h3 style={{ fontSize: '0.8rem' }}>Retry sync</h3><AdminActionForm action={retryConnectionSync} submitLabel="Retry sync" hidden={{ connectionId: id }} /></div>
        </div>
        <p className="admin-note">Credential replacement is deliberately NOT offered — there is no plaintext token UI. The strongest action is disable (fails closed) or request tenant reauthorization.</p>
      </div>

      <div className="admin-card">
        <h2>Connection history</h2>
        {d.events.length === 0 ? <p className="admin-note">No recorded events.</p> : (
          <table className="admin-table"><thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Reason / error</th></tr></thead>
            <tbody>{d.events.map((e, i) => (
              <tr key={i}><td>{new Date(e.createdAt).toISOString().slice(0, 19).replace('T', ' ')}</td><td>{e.event}</td><td>{e.actorType}</td><td>{e.reason ?? e.errorClassification ?? '—'}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
