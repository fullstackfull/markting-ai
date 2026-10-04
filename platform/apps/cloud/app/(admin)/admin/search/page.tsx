import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { globalSearch } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformOperator();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const res = q.length >= 2 ? await globalSearch(q) : { organizations: [], users: [], subscriptions: [] };
  return (
    <>
      <div className="admin-card">
        <h2>Global search</h2>
        <p className="admin-note">Search organizations (name/slug), users (display name / user id), and Stripe customer / subscription ids. No secrets are exposed.</p>
        <form className="admin-search" method="get">
          <input className="admin-input" type="search" name="q" placeholder="Search…" defaultValue={q} autoFocus />
          <button className="admin-btn" type="submit">Search</button>
        </form>
      </div>
      {q.length >= 2 && (
        <>
          <div className="admin-card"><h2>Organizations · {res.organizations.length}</h2>
            {res.organizations.length === 0 ? <p className="admin-note">None.</p> : <ul>{res.organizations.map((o) => <li key={o.id}><Link href={`/admin/organizations/${o.id}`}>{o.name}</Link> <span className="admin-note">({o.slug})</span></li>)}</ul>}
          </div>
          <div className="admin-card"><h2>Users · {res.users.length}</h2>
            {res.users.length === 0 ? <p className="admin-note">None.</p> : <ul>{res.users.map((u) => <li key={u.userId}><Link href={`/admin/users/${u.userId}`}>{u.displayName}</Link> <span className="admin-note">{u.userId.slice(0, 8)}</span></li>)}</ul>}
          </div>
          <div className="admin-card"><h2>Subscriptions · {res.subscriptions.length}</h2>
            {res.subscriptions.length === 0 ? <p className="admin-note">None.</p> : <ul>{res.subscriptions.map((s, i) => <li key={i}><Link href={`/admin/organizations/${s.organizationId}`}>{s.organizationId.slice(0, 8)}</Link> <span className="admin-note">{s.stripeCustomerId ?? s.stripeSubscriptionId}</span></li>)}</ul>}
          </div>
        </>
      )}
    </>
  );
}
