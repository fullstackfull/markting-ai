import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { listUsers } from '@/lib/platform/reads';

export const dynamic = 'force-dynamic';
const PAGE = 25;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePlatformOperator();
  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const { rows, total } = await listUsers({ search, limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(p) }).toString()}`;
  return (
    <div className="admin-card">
      <h2>Users · {total}</h2>
      <p className="admin-note">Email lives in the auth provider and is intentionally not exposed to the platform read role; search by display name or user id.</p>
      <form className="admin-search" method="get">
        <input className="admin-input" type="search" name="q" placeholder="Search display name or user id…" defaultValue={search} />
        <button className="admin-btn" type="submit">Search</button>
      </form>
      <table className="admin-table">
        <thead><tr><th>Display name</th><th>User id</th><th>Orgs</th><th>Operator</th><th>Created</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="admin-note">No users match.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.userId}>
              <td><Link href={`/admin/users/${r.userId}`}>{r.displayName}</Link></td>
              <td className="admin-note">{r.userId}</td>
              <td>{r.orgCount}</td>
              <td>{r.isOperator ? <span className="admin-tag warn">operator</span> : '—'}</td>
              <td>{new Date(r.createdAt).toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="admin-search" style={{ marginTop: '0.9rem', justifyContent: 'space-between' }}>
        <span className="admin-note">Page {page} of {pages}</span>
        <span>
          {page > 1 && <Link className="admin-tag" href={qs(page - 1)}>← Prev</Link>}{' '}
          {page < pages && <Link className="admin-tag" href={qs(page + 1)}>Next →</Link>}
        </span>
      </div>
    </div>
  );
}
