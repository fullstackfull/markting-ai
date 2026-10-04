import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { commerceFleet } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';

export default async function AdminCommercePage() {
  await requirePlatformOperator();
  const { stores, failingSync, deadLetters } = await commerceFleet();
  return (
    <>
      <div className="admin-grid">
        <div className="admin-kpi"><div className="label">Store connections</div><div className="value">{stores.reduce((a, s) => a + s.n, 0)}</div></div>
        <div className="admin-kpi"><div className="label">Stuck / errored syncs</div><div className="value">{failingSync.length}</div></div>
        <div className="admin-kpi"><div className="label">Dead-letter events</div><div className="value">{deadLetters}</div></div>
      </div>
      <div className="admin-card">
        <h2>Stores by platform &amp; status</h2>
        {stores.length === 0 ? <p className="admin-note">No store connections.</p> : (
          <table className="admin-table"><thead><tr><th>Platform</th><th>Status</th><th>Count</th></tr></thead>
            <tbody>{stores.map((s, i) => <tr key={i}><td>{s.platform}</td><td><span className={`admin-tag ${s.status === 'active' ? 'ok' : s.status === 'error' ? 'bad' : 'warn'}`}>{s.status}</span></td><td>{s.n}</td></tr>)}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Failing / stuck syncs</h2>
        {failingSync.length === 0 ? <p className="admin-note">No stores with sync errors.</p> : (
          <table className="admin-table"><thead><tr><th>Org</th><th>Platform</th><th>Status</th><th>Consecutive errors</th><th>Last run</th></tr></thead>
            <tbody>{failingSync.map((s, i) => (
              <tr key={i}><td><Link href={`/admin/organizations/${s.organizationId}`}>{s.organizationId.slice(0, 8)}</Link></td><td>{s.platform}</td><td><span className="admin-tag bad">{s.status}</span></td><td>{s.consecutiveErrors}</td><td className="admin-note">{s.lastRunAt ? new Date(s.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
