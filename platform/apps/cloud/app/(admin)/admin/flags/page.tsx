import { requirePlatformOperator } from '@/lib/platform/auth';
import { listFeatureFlags } from '@/lib/platform/ops-reads';
import { AdminActionForm } from '@/components/admin/action-form';
import { upsertFeatureFlag } from '@/lib/platform/ops-actions';

export const dynamic = 'force-dynamic';

export default async function AdminFlagsPage() {
  await requirePlatformOperator();
  const flags = await listFeatureFlags();
  return (
    <>
      <div className="admin-card">
        <h2>Feature flags</h2>
        <p className="admin-note">DB-backed, scoped global / plan / org, server-evaluated. Flags are product gating, NEVER security authorization. (The existing provider-rollout env allowlist still gates new OAuth providers; this complements it.)</p>
        {flags.length === 0 ? <p className="admin-note">No flags defined yet.</p> : (
          <table className="admin-table"><thead><tr><th>Key</th><th>Scope</th><th>Scope key</th><th>Enabled</th><th>Rollout %</th><th>Updated</th></tr></thead>
            <tbody>{flags.map((f, i) => (
              <tr key={i}><td>{f.key}</td><td>{f.scope}</td><td>{f.scopeKey || '—'}</td><td><span className={`admin-tag ${f.enabled ? 'ok' : ''}`}>{f.enabled ? 'on' : 'off'}</span></td><td>{f.rolloutPercent}</td><td className="admin-note">{new Date(f.updatedAt).toISOString().slice(0, 10)}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Create / update a flag</h2>
        <AdminActionForm action={upsertFeatureFlag} submitLabel="Save flag">
          <input className="admin-input" name="key" placeholder="flag key e.g. new_commerce_ui" required />
          <select className="admin-input" name="scope" defaultValue="global"><option value="global">global</option><option value="plan">plan</option><option value="org">org</option></select>
          <input className="admin-input" name="scopeKey" placeholder="scope key (plan id / org id; blank for global)" />
          <select className="admin-input" name="enabled" defaultValue="true"><option value="true">enabled</option><option value="false">disabled</option></select>
          <input className="admin-input" name="rolloutPercent" placeholder="rollout % (0-100)" defaultValue="100" />
        </AdminActionForm>
      </div>
    </>
  );
}
