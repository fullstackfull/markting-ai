import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { dataQualityFleet } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';

export default async function AdminDataQualityPage() {
  await requirePlatformOperator();
  const rows = await dataQualityFleet(80);
  return (
    <div className="admin-card">
      <h2>Data quality — fleet</h2>
      <p className="admin-note">Organizations with commerce sync gaps (consecutive errors), errored syncs, or stale data (&gt;2 days since last run). Per-batch DQ findings (malformed/mixed currency/missing COGS) are computed in-tenant; this fleet view surfaces the staleness/error signals persisted in sync state.</p>
      {rows.length === 0 ? <p className="admin-note">No data-quality signals across the fleet.</p> : (
        <table className="admin-table"><thead><tr><th>Org</th><th>Platform</th><th>Status</th><th>Consecutive errors</th><th>Last run</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td><Link href={`/admin/organizations/${r.organizationId}`}>{r.name}</Link></td><td>{r.platform}</td>
              <td><span className={`admin-tag ${r.status === 'error' ? 'bad' : r.consecutiveErrors > 0 ? 'warn' : ''}`}>{r.status}</span></td>
              <td>{r.consecutiveErrors}</td><td className="admin-note">{r.lastRunAt ? new Date(r.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') : 'never'}</td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}
