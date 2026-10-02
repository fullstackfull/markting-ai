import { Empty, PageHeader, Provider, formatDate } from '@/components/ui';
import { canAdminister, requireDashboardTenant } from '@/lib/cloud/dashboard';
import { listPendingOperations } from '@/lib/cloud/repository';
import { provenanceForPending } from '@/lib/markting/repository';
import { ApprovalActions } from './approval-actions';

export const metadata = { title: 'Approvals' };

export default async function ApprovalsPage() {
  const tenant = await requireDashboardTenant();
  const pending = await listPendingOperations(tenant.organizationId);
  const provenance = await provenanceForPending(tenant.organizationId, pending.map((operation) => operation.id));
  const canApply = canAdminister(tenant);
  return (
    <main className="page">
      <PageHeader title="Approvals" description="Previewed writes waiting for their exact second call. Each entry is hash-bound to its arguments and expires under the organization policy. Apply performs that second call through the same policy engine; Reject discards the preview." />
      <section className="card">
        {pending.length === 0 ? (
          <Empty title="No operations awaiting approval" copy="When an agent previews a guarded write, its exact operation, preview, and expiry appear here until it is applied or expires." />
        ) : (
          <>
            <div className="card-head"><h2>Pending operations</h2><span className="card-note">{pending.length} awaiting review</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Operation</th><th>Provider</th><th>Account</th><th>Kind</th><th>Source</th><th>Expires</th><th>Actions</th></tr></thead>
              <tbody>
                {pending.map((operation) => (
                  <tr key={operation.id}>
                    <td><strong>{operation.preview?.summary ?? operation.operation.tool}</strong><div className="cell-sub">{operation.id}</div></td>
                    <td><Provider name={operation.provider} /></td>
                    <td><span className="cell-sub" style={{ marginTop: 0 }}>{operation.operation.accountId}</span></td>
                    <td><span className="status neutral">{operation.operation.kind}</span></td>
                    <td>{(() => {
                      const source = provenance.get(operation.id);
                      if (!source) return <span className="cell-sub" style={{ marginTop: 0 }}>API / MCP</span>;
                      return <><span className="status">Assistant</span><div className="cell-sub">{source.engineToolName} · {source.engineAccountRef}/{source.engineTargetRef}</div><div className="cell-sub">{String((source.proposal as { reason?: string }).reason ?? '').slice(0, 160)}</div></>;
                    })()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(operation.expiresAt)}</td>
                    <td><ApprovalActions organizationId={tenant.organizationId} pendingId={operation.id} canApply={canApply} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </section>
    </main>
  );
}
