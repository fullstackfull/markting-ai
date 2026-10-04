import { requirePlatformOperator } from '@/lib/platform/auth';
import { listSettings } from '@/lib/platform/ops-reads';
import { AdminActionForm } from '@/components/admin/action-form';
import { updatePlatformSetting } from '@/lib/platform/ops-actions';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  await requirePlatformOperator();
  const settings = await listSettings();
  return (
    <>
      <div className="admin-card">
        <h2>Platform settings</h2>
        <p className="admin-note">Non-secret operational config (JSON values). SECRETS ARE NEVER STORED OR EDITABLE HERE — credentials live in the environment / encrypted vault. SUPER_ADMIN only; reason-required &amp; audited.</p>
        {settings.length === 0 ? <p className="admin-note">No settings defined yet.</p> : (
          <table className="admin-table"><thead><tr><th>Key</th><th>Value</th><th>Updated</th></tr></thead>
            <tbody>{settings.map((s) => (
              <tr key={s.key}><td>{s.key}</td><td className="admin-note"><code>{JSON.stringify(s.value)}</code></td><td className="admin-note">{new Date(s.updatedAt).toISOString().slice(0, 10)}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Set a value</h2>
        <AdminActionForm action={updatePlatformSetting} submitLabel="Save setting">
          <input className="admin-input" name="key" placeholder="setting key e.g. support.email" required />
          <input className="admin-input" name="value" placeholder='JSON value e.g. "ops@example.com" or {"threshold":5}' required />
        </AdminActionForm>
      </div>
    </>
  );
}
