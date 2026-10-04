import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { supportQueue, customerHealth } from '@/lib/platform/ops-reads';
import { AdminActionForm } from '@/components/admin/action-form';
import { updateSupportStatus } from '@/lib/platform/ops-actions';

export const dynamic = 'force-dynamic';

export default async function AdminSupportPage() {
  await requirePlatformOperator();
  const [tickets, health] = await Promise.all([supportQueue(50), customerHealth(50)]);
  const score = (h: { providerErrors: number; stuckSync: number; billingFailures: number; onboardingIncomplete: boolean; frozen: boolean }) =>
    h.providerErrors + h.stuckSync + h.billingFailures + (h.onboardingIncomplete ? 1 : 0) + (h.frozen ? 2 : 0);
  const unhealthy = health.filter((h) => score(h) > 0);
  return (
    <>
      <div className="admin-card">
        <h2>Support tickets</h2>
        <p className="admin-note">Triage queue over public.feedback. Status changes are reason-required and audited. (Email relay to support remains the tenant-facing path.)</p>
        {tickets.length === 0 ? <p className="admin-note">No tickets.</p> : (
          <table className="admin-table"><thead><tr><th>When</th><th>Org</th><th>Subject</th><th>Status</th><th>Advance</th></tr></thead>
            <tbody>{tickets.map((t) => (
              <tr key={t.id}><td className="admin-note">{new Date(t.createdAt).toISOString().slice(0, 10)}</td>
                <td><Link href={`/admin/organizations/${t.organizationId}`}>{t.organizationId.slice(0, 8)}</Link></td>
                <td>{t.subject ?? '—'}</td>
                <td><span className={`admin-tag ${t.status === 'resolved' ? 'ok' : t.status === 'new' ? 'warn' : ''}`}>{t.status}</span></td>
                <td><AdminActionForm action={updateSupportStatus} submitLabel="Set status" hidden={{ id: t.id }}>
                  <select className="admin-input" name="status" defaultValue={t.status}><option value="new">new</option><option value="in_progress">in_progress</option><option value="resolved">resolved</option></select>
                </AdminActionForm></td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div className="admin-card">
        <h2>Customer health (deterministic, not an LLM)</h2>
        <p className="admin-note">Score = provider errors + stuck syncs + open billing failures + onboarding-incomplete + (frozen×2). Computed purely from DB signals.</p>
        {unhealthy.length === 0 ? <p className="admin-note">No organizations currently show health signals.</p> : (
          <table className="admin-table"><thead><tr><th>Org</th><th>Score</th><th>Provider err</th><th>Stuck sync</th><th>Billing</th><th>Onboarding</th><th>Frozen</th></tr></thead>
            <tbody>{unhealthy.map((h) => (
              <tr key={h.organizationId}><td><Link href={`/admin/organizations/${h.organizationId}`}>{h.name}</Link></td>
                <td><span className={`admin-tag ${score(h) >= 3 ? 'bad' : 'warn'}`}>{score(h)}</span></td>
                <td>{h.providerErrors}</td><td>{h.stuckSync}</td><td>{h.billingFailures}</td><td>{h.onboardingIncomplete ? 'incomplete' : 'ok'}</td><td>{h.frozen ? 'yes' : 'no'}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
