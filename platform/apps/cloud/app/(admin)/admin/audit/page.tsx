import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { globalAudit } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  await requirePlatformOperator();
  const sp = await searchParams;
  const organizationId = (sp.org ?? '').trim() || undefined;
  const { platform, tenant } = await globalAudit({ organizationId, limit: 150 });
  return (
    <>
      <div className="admin-card">
        <h2>Global audit</h2>
        <p className="admin-note">Unified view of platform-admin actions (append-only) and tenant audit events, linkable by correlation id. Filter tenant events by organization id.</p>
        <form className="admin-search" method="get">
          <input className="admin-input" type="search" name="org" placeholder="Filter tenant events by org id…" defaultValue={organizationId ?? ''} />
          <button className="admin-btn" type="submit">Filter</button>
        </form>
      </div>
      <div className="admin-card">
        <h2>Platform admin actions · {platform.length}</h2>
        {platform.length === 0 ? <p className="admin-note">No platform admin actions yet.</p> : (
          <table className="admin-table"><thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
            <tbody>{platform.map((a, i) => (
              <tr key={i}><td className="admin-note">{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="admin-note">{a.actorUserId ? <Link href={`/admin/users/${a.actorUserId}`}>{a.actorUserId.slice(0, 8)}</Link> : '—'}</td>
                <td>{a.platformRole}</td><td>{a.action}</td><td className="admin-note">{a.targetType ? `${a.targetType}:${(a.targetId ?? '').slice(0, 8)}` : '—'}</td><td>{a.reason ?? '—'}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Tenant audit events · {tenant.length}</h2>
        {tenant.length === 0 ? <p className="admin-note">No tenant audit events{organizationId ? ' for this org' : ''}.</p> : (
          <table className="admin-table"><thead><tr><th>When</th><th>Org</th><th>Event</th><th>Provider</th><th>Summary</th></tr></thead>
            <tbody>{tenant.map((a, i) => (
              <tr key={i}><td className="admin-note">{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td><Link href={`/admin/organizations/${a.organizationId}`}>{a.organizationId.slice(0, 8)}</Link></td>
                <td>{a.event}</td><td>{a.provider ?? '—'}</td><td className="admin-note">{a.summary ?? '—'}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
