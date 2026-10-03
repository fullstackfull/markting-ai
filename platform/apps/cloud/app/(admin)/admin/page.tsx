import { requirePlatformOperator } from '@/lib/platform/auth';
import { platformOverview } from '@/lib/platform/reads';

export const dynamic = 'force-dynamic';

function Kpi({ label, value }: { label: string; value: number | string | null }) {
  const na = value === null || value === undefined;
  return (
    <div className="admin-kpi">
      <div className="label">{label}</div>
      <div className={`value${na ? ' na' : ''}`}>{na ? 'NOT_AVAILABLE' : value}</div>
    </div>
  );
}

export default async function AdminOverviewPage() {
  await requirePlatformOperator();
  const o = await platformOverview();
  const costUnits = (o.aiCostMicros / 1_000_000).toFixed(2);
  return (
    <>
      <div className="admin-grid">
        <Kpi label="Users" value={o.users} />
        <Kpi label="Organizations" value={o.organizations} />
        <Kpi label="Active orgs" value={o.activeOrganizations} />
        <Kpi label="Trials" value={o.trials} />
        <Kpi label="Connected ad accounts" value={o.connectedAdAccounts} />
        <Kpi label="Connected stores" value={o.connectedStores} />
        <Kpi label="AI requests (billable)" value={o.aiRequests} />
        <Kpi label="AI est. cost (units)" value={o.aiRequests === 0 ? 'NOT_AVAILABLE' : costUnits} />
        <Kpi label="Onboarding completed" value={o.onboardingCompleted} />
        <Kpi label="Pending approvals" value={o.pendingApprovals} />
        <Kpi label="Active kill switches" value={o.activeKillSwitches} />
      </div>

      <div className="admin-card">
        <h2>Subscriptions by status</h2>
        {Object.keys(o.subscriptionsByStatus).length === 0 ? (
          <p className="admin-note">NOT_AVAILABLE — no subscription rows.</p>
        ) : (
          <table className="admin-table">
            <thead><tr><th>Status</th><th>Count</th></tr></thead>
            <tbody>
              {Object.entries(o.subscriptionsByStatus).map(([status, n]) => (
                <tr key={status}><td>{status}</td><td>{n}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-card">
        <h2>Platform health</h2>
        <p className="admin-note">
          DB: reachable (this page read live counts). AI gateway: deterministic / local-fallback by
          design (no live model traffic) — cost accrues only when a live model is wired. Jobs / webhooks
          / Stripe / provider &amp; commerce freshness: live edge status is NOT_AVAILABLE from inside the
          app; surfaced where internal evidence exists on the section pages. No fake GREEN is shown.
        </p>
      </div>
    </>
  );
}
