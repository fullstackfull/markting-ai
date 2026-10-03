import { getSessionPlatformOperator } from '@/lib/platform/auth';
import { listActiveKillSwitchesAll } from '@/lib/platform/reads';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { GlobalKillForm } from './global-kill-form';

export const dynamic = 'force-dynamic';

export default async function AdminGovernancePage() {
  const operator = await getSessionPlatformOperator();
  if (!operator) return null; // layout already guards; satisfies types
  const kills = await listActiveKillSwitchesAll();
  const globalActive = kills.some((k) => k.scope === 'GLOBAL');
  let runtimeMode = 'unknown';
  try { runtimeMode = resolveRuntimeMode(); } catch { runtimeMode = 'unknown'; }
  return (
    <>
      <div className="admin-card">
        <h2>Runtime &amp; write safety</h2>
        <p className="admin-note">
          Runtime mode <span className="admin-tag">{runtimeMode}</span> · Mode-B provider writes <span className="admin-tag warn">HELD</span> · Autonomous optimization <span className="admin-tag">DISABLED</span>.
          Provider writes pass a single server-side seam that evaluates the kill switch and fails closed (WAVE 0).
        </p>
      </div>

      <div className="admin-card">
        <h2>GLOBAL kill switch {globalActive ? <span className="admin-tag bad">ACTIVE</span> : <span className="admin-tag ok">off</span>}</h2>
        <p className="admin-note">Halts ALL provider writes across every tenant immediately. Highest-impact control — SUPER_ADMIN only.</p>
        {operator.role === 'SUPER_ADMIN'
          ? <GlobalKillForm active={globalActive} />
          : <p className="admin-note">Your role ({operator.role}) cannot change the global kill switch. Per-organization freeze is available on an organization&apos;s page.</p>}
      </div>

      <div className="admin-card">
        <h2>Active kill switches · {kills.length}</h2>
        {kills.length === 0 ? <p className="admin-note">None active.</p> : (
          <table className="admin-table">
            <thead><tr><th>Scope</th><th>Key</th><th>Org</th><th>Reason</th></tr></thead>
            <tbody>{kills.map((k, i) => (<tr key={i}><td><span className="admin-tag bad">{k.scope}</span></td><td>{k.scopeKey || '—'}</td><td className="admin-note">{k.organizationId ?? 'platform-wide'}</td><td>{k.reason ?? '—'}</td></tr>))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
