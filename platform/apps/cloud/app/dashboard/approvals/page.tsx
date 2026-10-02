import { Empty, PageHeader, Provider, formatDate } from '@/components/ui';
import { canAdminister, requireDashboardTenant } from '@/lib/cloud/dashboard';
import { listPendingOperations } from '@/lib/cloud/repository';
import { provenanceForPending } from '@/lib/markting/repository';
import { ApprovalActions } from './approval-actions';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Approvals' };

export default async function ApprovalsPage() {
  const tenant = await requireDashboardTenant();
  const pending = await listPendingOperations(tenant.organizationId);
  const provenance = await provenanceForPending(tenant.organizationId, pending.map((operation) => operation.id));
  const canApply = canAdminister(tenant);
  const { t, tn, locale } = await getT();
  return (
    <main className="page">
      <PageHeader title={t('approvals.title')} description={t('approvals.description')} />
      <section className="card">
        {pending.length === 0 ? (
          <Empty title={t('approvals.emptyTitle')} copy={t('approvals.emptyCopy')} />
        ) : (
          <>
            <div className="card-head"><h2>{t('approvals.pendingOperations')}</h2><span className="card-note">{tn('approvals.awaitingReview', pending.length)}</span></div>
            <div className="table-wrap"><table>
              <thead><tr><th>{t('approvals.operation')}</th><th>{t('approvals.provider')}</th><th>{t('approvals.account')}</th><th>{t('approvals.kind')}</th><th>{t('approvals.source')}</th><th>{t('approvals.expires')}</th><th>{t('approvals.actions')}</th></tr></thead>
              <tbody>
                {pending.map((operation) => (
                  <tr key={operation.id}>
                    <td><strong>{operation.preview?.summary ?? operation.operation.tool}</strong><div className="cell-sub">{operation.id}</div></td>
                    <td><Provider name={operation.provider} /></td>
                    <td><span className="cell-sub" style={{ marginTop: 0 }}>{operation.operation.accountId}</span></td>
                    <td><span className="status neutral">{t(`common.kind_${operation.operation.kind}`)}</span></td>
                    <td>{(() => {
                      const source = provenance.get(operation.id);
                      if (!source) return <span className="cell-sub" style={{ marginTop: 0 }}>{t('approvals.sourceApi')}</span>;
                      return <><span className="status">{t('approvals.sourceAssistant')}</span><div className="cell-sub">{source.engineToolName} · {source.engineAccountRef}/{source.engineTargetRef}</div><div className="cell-sub">{String((source.proposal as { reason?: string }).reason ?? '').slice(0, 160)}</div></>;
                    })()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(operation.expiresAt, locale)}</td>
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
