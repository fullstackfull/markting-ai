import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { listOrganizations } from '@/lib/platform/reads';

export const dynamic = 'force-dynamic';
const PAGE = 25;

export default async function AdminOrganizationsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePlatformOperator();
  const sp = await searchParams;
  const search = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const { rows, total } = await listOrganizations({ search, limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(p) }).toString()}`;
  return (
    <div className="admin-card">
      <h2>Organizations · {total}</h2>
      <form className="admin-search" method="get">
        <input className="admin-input" type="search" name="q" placeholder="Search name or slug…" defaultValue={search} />
        <button className="admin-btn" type="submit">Search</button>
      </form>
      <table className="admin-table">
        <thead><tr><th>Name</th><th>Slug</th><th>Plan</th><th>Status</th><th>Members</th><th>Ad accts</th><th>Created</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="admin-note">No organizations match.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/admin/organizations/${r.id}`}>{r.name}</Link></td>
              <td>{r.slug}</td>
              <td>{r.plan}</td>
              <td><span className={`admin-tag ${r.status === 'active' || r.status === 'trialing' ? 'ok' : r.status === 'past_due' ? 'warn' : 'bad'}`}>{r.status}</span></td>
              <td>{r.members}</td>
              <td>{r.adAccounts}</td>
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
