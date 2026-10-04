import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { aiFleet } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';
const units = (micros: number) => (micros / 1_000_000).toFixed(2);

export default async function AdminAiPage() {
  await requirePlatformOperator();
  const f = await aiFleet();
  return (
    <>
      <div className="admin-grid">
        <div className="admin-kpi"><div className="label">Billable AI requests</div><div className="value">{f.requests}</div></div>
        <div className="admin-kpi"><div className="label">Est. cost (units)</div><div className={`value${f.requests === 0 ? ' na' : ''}`}>{f.requests === 0 ? 'NOT_AVAILABLE' : units(f.costMicros)}</div></div>
        <div className="admin-kpi"><div className="label">Errors</div><div className="value">{f.errors}</div></div>
      </div>
      <p className="admin-note" style={{ marginTop: '0.6rem' }}>
        The AI gateway is deterministic / local-fallback today (no live model traffic), so billable cost is typically
        zero / NOT_AVAILABLE until a live model is wired (<span className="admin-tag">BLOCKED_EXTERNAL</span>). Per-org
        quota overrides and hard-disable are set on each organization&apos;s page and stored in organization_ai_limits.
        Model routing / allowlist controls: <span className="admin-tag">NOT_CONFIGURED</span> (no live router).
      </p>
      <div className="admin-card">
        <h2>Cost by model</h2>
        {f.byModel.length === 0 ? <p className="admin-note">NOT_AVAILABLE — no billable model usage recorded.</p> : (
          <table className="admin-table"><thead><tr><th>Model</th><th>Requests</th><th>Cost (units)</th></tr></thead>
            <tbody>{f.byModel.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.requests}</td><td>{units(m.costMicros)}</td></tr>)}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Top organizations by AI usage</h2>
        {f.topOrgs.length === 0 ? <p className="admin-note">NOT_AVAILABLE — no billable org usage recorded.</p> : (
          <table className="admin-table"><thead><tr><th>Org</th><th>Requests</th><th>Cost (units)</th></tr></thead>
            <tbody>{f.topOrgs.map((o) => <tr key={o.organizationId}><td><Link href={`/admin/organizations/${o.organizationId}`}>{o.name}</Link></td><td>{o.requests}</td><td>{units(o.costMicros)}</td></tr>)}</tbody></table>
        )}
      </div>
    </>
  );
}
