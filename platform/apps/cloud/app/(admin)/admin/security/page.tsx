import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { listActiveKillSwitchesAll, listPlatformAudit } from '@/lib/platform/reads';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';

export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  await requirePlatformOperator();
  const [kills, audit] = await Promise.all([listActiveKillSwitchesAll(), listPlatformAudit(100)]);
  let runtimeMode = 'unknown';
  try { runtimeMode = resolveRuntimeMode(); } catch { runtimeMode = 'unknown'; }
  return (
    <>
      <div className="admin-card">
        <h2>Safety posture</h2>
        <p className="admin-note">
          Runtime mode: <span className="admin-tag">{runtimeMode}</span> · Mode-B provider writes: <span className="admin-tag warn">HELD</span> · Autonomous optimization: <span className="admin-tag">DISABLED</span>. Kill switches are enforced server-side on the provider-apply seam (WAVE 0).
        </p>
      </div>

      <div className="admin-card">
        <h2>Active kill switches · {kills.length}</h2>
        {kills.length === 0 ? <p className="admin-note">No active kill switches.</p> : (
          <table className="admin-table">
            <thead><tr><th>Scope</th><th>Key</th><th>Org</th><th>Reason</th><th>Since</th></tr></thead>
            <tbody>{kills.map((k, i) => (
              <tr key={i}><td><span className="admin-tag bad">{k.scope}</span></td><td>{k.scopeKey || '—'}</td><td className="admin-note">{k.organizationId ?? 'platform-wide'}</td><td>{k.reason ?? '—'}</td><td>{k.setAt ? new Date(k.setAt).toISOString().slice(0, 16).replace('T', ' ') : '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h2>Platform admin audit (recent) · {audit.length}</h2>
        <p className="admin-note">Append-only record of every privileged platform action. Tenant-level audit lives per-organization (linkable by correlation id).</p>
        {audit.length === 0 ? <p className="admin-note">No platform admin actions recorded yet.</p> : (
          <table className="admin-table">
            <thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th><th>Reason</th></tr></thead>
            <tbody>{audit.map((a) => (
              <tr key={a.id}>
                <td className="admin-note">{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="admin-note">{a.actorUserId ? <Link href={`/admin/users/${a.actorUserId}`}>{a.actorUserId.slice(0, 8)}</Link> : '—'}</td>
                <td>{a.platformRole}</td>
                <td>{a.action}</td>
                <td className="admin-note">{a.targetType ? `${a.targetType}:${(a.targetId ?? '').slice(0, 8)}` : '—'}</td>
                <td>{a.reason ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
