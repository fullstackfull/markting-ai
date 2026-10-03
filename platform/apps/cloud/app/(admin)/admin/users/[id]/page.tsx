import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { getUserDetail } from '@/lib/platform/reads';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformOperator();
  const { id } = await params;
  const user = await getUserDetail(id);
  if (!user) notFound();
  return (
    <>
      <div className="admin-topbar" style={{ borderBottom: 'none', marginBottom: 0 }}>
        <div>
          <h1 style={{ fontSize: '1.05rem' }}>{user.displayName ?? user.userId}</h1>
          <p className="admin-note">{user.userId}{user.isOperator ? ` · platform ${user.operatorRole}` : ''}</p>
        </div>
        <Link className="admin-tag" href="/admin/users">← All users</Link>
      </div>

      <div className="admin-card">
        <h2>Organizations &amp; roles</h2>
        {user.memberships.length === 0 ? <p className="admin-note">No organization memberships.</p> : (
          <table className="admin-table">
            <thead><tr><th>Organization</th><th>Tenant role</th></tr></thead>
            <tbody>{user.memberships.map((m) => (
              <tr key={m.organizationId}><td><Link href={`/admin/organizations/${m.organizationId}`}>{m.organizationName}</Link></td><td>{m.role}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h2>Account actions</h2>
        <p className="admin-note">
          Suspend / revoke sessions / revoke keys / export / impersonation are not yet wired (PARTIAL) —
          they require auth-provider session APIs and are tracked in the implementation log. The tenant
          roles above are informational; a tenant role never confers platform authority.
        </p>
      </div>
    </>
  );
}
