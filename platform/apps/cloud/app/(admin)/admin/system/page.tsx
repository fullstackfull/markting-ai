import { requirePlatformOperator } from '@/lib/platform/auth';
import { jobsOverview } from '@/lib/platform/ops-reads';

export const dynamic = 'force-dynamic';

export default async function AdminSystemPage() {
  await requirePlatformOperator();
  const { reconciliation, observation } = await jobsOverview();
  const terminalBad = (s: string) => ['GAVE_UP', 'failed'].includes(s);
  const section = (title: string, rows: Array<{ status: string; n: number }>) => (
    <div className="admin-card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="admin-note">No jobs enqueued.</p> : (
        <table className="admin-table"><thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.status}><td><span className={`admin-tag ${terminalBad(r.status) ? 'bad' : 'ok'}`}>{r.status}</span></td><td>{r.n}</td></tr>)}</tbody></table>
      )}
    </div>
  );
  return (
    <>
      <div className="admin-card">
        <h2>System health</h2>
        <p className="admin-note">
          DB: reachable (this page read live job state). The reconciliation / observation queues have no in-repo
          runner yet, so counts reflect enqueued state only. A worker + retry/dead-letter controls are roadmap.
          Edge health (webhooks, Stripe, provider/commerce freshness) and a /health endpoint are
          <span className="admin-tag">BLOCKED_EXTERNAL</span> (live infra outside the app) — shown as NOT_AVAILABLE
          rather than a fake GREEN. Provider-write jobs are never manually replayed outside the Phase-0
          execution/idempotency contract.
        </p>
      </div>
      {section('Reconciliation jobs', reconciliation)}
      {section('Observation jobs', observation)}
    </>
  );
}
