import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { dataQualityFleet } from '@/lib/platform/ops-reads';
import { quarantineOverview } from '@/lib/markting/ops/quarantine';

export const dynamic = 'force-dynamic';

export default async function AdminDataQualityPage() {
  await requirePlatformOperator();
  const [rows, quarantine] = await Promise.all([dataQualityFleet(80), quarantineOverview(50)]);
  return (
    <>
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

      <div className="admin-card">
        <h2>Quarantine</h2>
        <p className="admin-note">Rows the normalizer refused to admit to canonical intelligence (malformed shape, breaking schema drift, impossible metrics, ownership mismatch, unsupported currency, invalid timestamp). Counts are deduplicated per org / provider / account / reason. Samples are sanitizer-redacted and never shown here.</p>
        {quarantine.total === 0 ? <p className="admin-note">No quarantined rows across the fleet.</p> : (
          <>
            <table className="admin-table"><thead><tr><th>Reason</th><th>Count</th></tr></thead>
              <tbody>{quarantine.byReason.map((r) => (
                <tr key={r.reason}><td><span className="admin-tag warn">{r.reason}</span></td><td>{r.count}</td></tr>
              ))}</tbody></table>
            <h3 style={{ marginTop: '1rem' }}>Recent sources</h3>
            <table className="admin-table"><thead><tr><th>Org</th><th>Provider</th><th>Account</th><th>Reason</th><th>Count</th><th>Last seen</th></tr></thead>
              <tbody>{quarantine.recent.map((r, i) => (
                <tr key={i}><td><Link href={`/admin/organizations/${r.organizationId}`}>{r.organizationId}</Link></td><td>{r.provider}</td>
                  <td>{r.accountId}</td><td><span className="admin-tag warn">{r.reason}</span></td><td>{r.count}</td>
                  <td className="admin-note">{new Date(r.lastSeenAtMs).toISOString().slice(0, 16).replace('T', ' ')}</td></tr>
              ))}</tbody></table>
          </>
        )}
      </div>
    </>
  );
}
