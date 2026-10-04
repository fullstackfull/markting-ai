import Link from 'next/link';
import { requirePlatformOperator } from '@/lib/platform/auth';
import { billingOverview, listSubscribers, listBillingFailures, listPlans } from '@/lib/platform/ops-reads';
import { AdminActionForm } from '@/components/admin/action-form';
import { updatePlan, resolveBillingFailure } from '@/lib/platform/ops-actions';

export const dynamic = 'force-dynamic';

export default async function AdminBillingPage() {
  await requirePlatformOperator();
  const [o, subs, failures, plans] = await Promise.all([billingOverview(), listSubscribers({ limit: 25 }), listBillingFailures(25), listPlans()]);
  return (
    <>
      <div className="admin-grid">
        <div className="admin-kpi"><div className="label">MRR (EUR, monthly-equiv list)</div><div className="value">€{o.mrrEur}</div></div>
        <div className="admin-kpi"><div className="label">Paying subs</div><div className="value">{o.payingSubs}</div></div>
        <div className="admin-kpi"><div className="label">ARR (×12)</div><div className="value">€{o.mrrEur * 12}</div></div>
        <div className="admin-kpi"><div className="label">Trials</div><div className="value">{o.trials}</div></div>
        <div className="admin-kpi"><div className="label">Open payment failures</div><div className="value">{o.openFailures}</div></div>
      </div>
      <p className="admin-note" style={{ marginTop: '0.6rem' }}>
        MRR = sum of active+past_due subscriptions&apos; plan monthly list price (subscription interval is not stored,
        so annual plans count at list monthly price — a documented simplification). Tax/VAT/SAR multi-currency:
        <span className="admin-tag">BLOCKED_EXTERNAL</span> (not implemented; not faked). Invoice history &amp; churn
        require live Stripe data (<span className="admin-tag">BLOCKED_EXTERNAL</span>).
      </p>

      <div className="admin-card">
        <h2>Plan catalog (edit limits — SUPER_ADMIN)</h2>
        <p className="admin-note">The entitlement resolver prefers these rows (code fallback otherwise), then applies per-org overrides, then the safety ceiling. Historical invoices are never altered.</p>
        <table className="admin-table">
          <thead><tr><th>Plan</th><th>€/mo</th><th>Accounts</th><th>Members</th><th>Retention(d)</th><th>Write</th><th>Edit limits</th></tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.id}>
              <td>{p.name} <span className="admin-note">({p.id})</span></td>
              <td>{p.monthlyPriceEur ?? '—'}</td><td>{p.maxActiveAccounts ?? '∞'}</td><td>{p.maxMembers ?? '∞'}</td>
              <td>{p.maxRetentionDays}</td><td>{p.writeAccess ? 'yes' : 'no'}</td>
              <td>
                <AdminActionForm action={updatePlan} submitLabel="Save" hidden={{ id: p.id }}>
                  <input className="admin-input" name="maxActiveAccounts" placeholder="accounts" defaultValue={p.maxActiveAccounts ?? ''} />
                  <input className="admin-input" name="maxMembers" placeholder="members" defaultValue={p.maxMembers ?? ''} />
                  <input className="admin-input" name="maxRetentionDays" placeholder="retention days" defaultValue={p.maxRetentionDays} />
                </AdminActionForm>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="admin-card">
        <h2>Subscriptions by status</h2>
        <table className="admin-table"><thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>{Object.entries(o.byStatus).map(([s, n]) => <tr key={s}><td>{s}</td><td>{n}</td></tr>)}</tbody></table>
      </div>

      <div className="admin-card">
        <h2>Subscribers (recent)</h2>
        <table className="admin-table"><thead><tr><th>Org</th><th>Plan</th><th>Status</th><th>Stripe customer</th></tr></thead>
          <tbody>{subs.map((s) => (<tr key={s.organizationId}><td><Link href={`/admin/organizations/${s.organizationId}`}>{s.name}</Link></td><td>{s.plan}</td><td>{s.status}</td><td className="admin-note">{s.stripeCustomerId ?? '—'}</td></tr>))}</tbody></table>
      </div>

      <div className="admin-card">
        <h2>Payment failures {o.openFailures > 0 ? <span className="admin-tag bad">{o.openFailures} open</span> : <span className="admin-tag ok">none open</span>}</h2>
        {failures.length === 0 ? <p className="admin-note">No payment failures recorded (populated by the Stripe webhook on invoice.payment_failed).</p> : (
          <table className="admin-table"><thead><tr><th>When</th><th>Org</th><th>Event</th><th>Amount due</th><th>Attempts</th><th>Resolve</th></tr></thead>
            <tbody>{failures.map((f) => (
              <tr key={f.id}><td className="admin-note">{new Date(f.createdAt).toISOString().slice(0, 10)}</td>
                <td>{f.organizationId ? <Link href={`/admin/organizations/${f.organizationId}`}>{f.organizationId.slice(0, 8)}</Link> : '—'}</td>
                <td>{f.eventType}</td><td>{f.amountDueMinor != null ? `${(f.amountDueMinor / 100).toFixed(2)} ${f.currency ?? ''}` : '—'}</td><td>{f.attemptCount ?? '—'}</td>
                <td>{f.resolved ? <span className="admin-tag ok">resolved</span> : <AdminActionForm action={resolveBillingFailure} submitLabel="Resolve" hidden={{ id: f.id }} />}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
