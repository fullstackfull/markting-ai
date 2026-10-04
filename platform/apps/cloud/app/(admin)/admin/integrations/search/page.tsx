import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { searchConnections } from '@/lib/connections/platform-read';

export const dynamic = 'force-dynamic';

export default async function AdminConnectionSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformOperator();
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const results = query.length >= 2 ? await searchConnections(query) : null;
  return (
    <>
      <p className="admin-note"><Link className="inline-link" href="/admin/integrations">← Integration fleet</Link></p>
      <div className="admin-card">
        <h2>Connection search</h2>
        <form action="/admin/integrations/search" method="get" className="admin-form">
          <input name="q" defaultValue={query} placeholder="provider / ad account / org / store / stripe id" className="admin-input" aria-label="Connection search" />
          <button className="admin-btn" type="submit">Search</button>
        </form>
        <p className="admin-note">No secrets are returned. Stripe ids match exactly; the rest are substring matches.</p>
      </div>
      {results ? (
        <>
          <ResultTable title={`Connections (${results.connections.length})`} headers={['Org', 'Provider', 'Status', 'Label', '']}
            rows={results.connections.map((c) => [c.orgName, c.provider, c.status, c.externalLabel ?? '—', <Link key={c.connectionId} className="inline-link" href={`/admin/integrations/connection/${c.connectionId}`}>Open →</Link>])} />
          <ResultTable title={`Ad accounts (${results.adAccounts.length})`} headers={['Provider', 'Account id', 'Name', 'Org']}
            rows={results.adAccounts.map((a) => [a.provider, a.accountId, a.name, a.organizationId])} />
          <ResultTable title={`Commerce stores (${results.stores.length})`} headers={['Platform', 'Store id', 'Status', 'Org']}
            rows={results.stores.map((s) => [s.platform, s.storeId, s.status, s.organizationId])} />
          <ResultTable title={`Subscriptions (${results.subscriptions.length})`} headers={['Org', 'Stripe customer', 'Stripe subscription']}
            rows={results.subscriptions.map((s) => [s.organizationId, s.stripeCustomerId ?? '—', s.stripeSubscriptionId ?? '—'])} />
        </>
      ) : <p className="admin-note">Enter at least 2 characters.</p>}
    </>
  );
}

function ResultTable({ title, headers, rows }: { title: string; headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="admin-card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="admin-note">No matches.</p> : (
        <table className="admin-table"><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>
      )}
    </div>
  );
}
