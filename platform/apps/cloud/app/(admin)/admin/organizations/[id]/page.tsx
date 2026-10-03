import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { getOrganizationDetail } from '@/lib/platform/reads';
import { FreezeForm } from './freeze-form';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformOperator();
  const { id } = await params;
  const org = await getOrganizationDetail(id);
  if (!org) notFound();
  const orgFrozen = org.activeKillSwitches.some((k) => k.scope === 'ORGANIZATION' && k.scopeKey === id);
  const globalKill = org.activeKillSwitches.some((k) => k.scope === 'GLOBAL');
  return (
    <>
      <div className="admin-topbar" style={{ borderBottom: 'none', marginBottom: 0 }}>
        <div>
          <h1 style={{ fontSize: '1.05rem' }}>{org.name}</h1>
          <p className="admin-note">{org.slug} · {org.id}</p>
        </div>
        <Link className="admin-tag" href="/admin/organizations">← All organizations</Link>
      </div>

      <div className="admin-grid" style={{ marginTop: '1rem' }}>
        <div className="admin-kpi"><div className="label">Plan</div><div className="value" style={{ fontSize: '1rem' }}>{org.plan}</div></div>
        <div className="admin-kpi"><div className="label">Status</div><div className="value" style={{ fontSize: '1rem' }}>{org.status}</div></div>
        <div className="admin-kpi"><div className="label">Members</div><div className="value">{org.members.length}</div></div>
        <div className="admin-kpi"><div className="label">Ad accounts</div><div className="value">{org.adAccounts.length}</div></div>
        <div className="admin-kpi"><div className="label">AI requests</div><div className="value">{org.aiRequests}</div></div>
        <div className="admin-kpi"><div className="label">Onboarding</div><div className="value" style={{ fontSize: '0.95rem' }}>{org.onboardingCompletedAt ? 'complete' : 'incomplete'}</div></div>
      </div>

      <div className="admin-card">
        <h2>Governance &amp; safety</h2>
        <p className="admin-note">
          Write status: {globalKill ? <span className="admin-tag bad">GLOBAL kill active</span> : orgFrozen ? <span className="admin-tag bad">FROZEN (org)</span> : <span className="admin-tag ok">writes allowed</span>}
          {org.stripeCustomerId ? <> · Stripe customer <code>{org.stripeCustomerId}</code></> : null}
        </p>
        <FreezeForm organizationId={org.id} frozen={orgFrozen} />
        {org.activeKillSwitches.length > 0 && (
          <table className="admin-table" style={{ marginTop: '0.8rem' }}>
            <thead><tr><th>Scope</th><th>Key</th><th>Reason</th></tr></thead>
            <tbody>{org.activeKillSwitches.map((k, i) => (<tr key={i}><td>{k.scope}</td><td>{k.scopeKey || '—'}</td><td>{k.reason ?? '—'}</td></tr>))}</tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h2>Members</h2>
        <table className="admin-table">
          <thead><tr><th>User</th><th>Role</th></tr></thead>
          <tbody>{org.members.map((m) => (
            <tr key={m.userId}><td><Link href={`/admin/users/${m.userId}`}>{m.displayName ?? m.userId}</Link></td><td>{m.role}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <div className="admin-card">
        <h2>Connections</h2>
        {org.connections.length === 0 ? <p className="admin-note">No provider connections.</p> : (
          <table className="admin-table">
            <thead><tr><th>Provider</th><th>Status</th><th>Last verified</th><th>Last error</th></tr></thead>
            <tbody>{org.connections.map((c, i) => (
              <tr key={i}><td>{c.provider}</td><td><span className={`admin-tag ${c.status === 'connected' ? 'ok' : c.status === 'revoked' ? 'bad' : 'warn'}`}>{c.status}</span></td><td>{c.lastVerifiedAt ? new Date(c.lastVerifiedAt).toISOString().slice(0, 10) : '—'}</td><td className="admin-note">{c.lastError ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h2>Ad accounts</h2>
        {org.adAccounts.length === 0 ? <p className="admin-note">No ad accounts.</p> : (
          <table className="admin-table">
            <thead><tr><th>Provider</th><th>Account</th><th>Name</th><th>Enabled</th></tr></thead>
            <tbody>{org.adAccounts.map((a, i) => (
              <tr key={i}><td>{a.provider}</td><td>{a.accountId}</td><td>{a.name}</td><td>{a.enabled ? 'yes' : 'no'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
