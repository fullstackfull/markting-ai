import Link from 'next/link';
import { Empty, PageHeader, Provider, StatusPill } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { countAuditEvents, listConnections, listPendingOperations } from '@/lib/cloud/repository';
import { LiveData } from './live-data';
import { isSyntheticReviewer } from '@/lib/cloud/synthetic-reviewer';
import { SyntheticReviewer } from '@/components/synthetic-reviewer';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const tenant = await requireDashboardTenant();
  const { t, tn } = await getT();
  if (isSyntheticReviewer(tenant.organizationId)) return <SyntheticReviewer tenant={tenant} />;
  const [connections, pending, auditCount] = await Promise.all([
    listConnections(tenant.organizationId),
    listPendingOperations(tenant.organizationId, 5),
    countAuditEvents(tenant.organizationId),
  ]);
  const connected = connections.filter((connection) => connection.status === 'connected');
  return (
    <main className="page">
      <PageHeader
        title={t('overview.title')}
        description={t('overview.description')}
        action={<Link className="button secondary" href="/dashboard/reports" prefetch={false}>{t('overview.openFullReport')}</Link>}
      />
      {connections.length === 0 ? (
        <div className="card">
          <Empty
            title={t('overview.emptyTitle')}
            copy={t('overview.emptyCopy')}
            href="/dashboard/connections"
            action={t('overview.openConnections')}
          />
        </div>
      ) : (
        <>
          <LiveData organizationId={tenant.organizationId} connected={connected.length > 0} />
          <div className="grid-2" style={{ marginTop: '0.9rem' }}>
            <section className="card">
              <div className="card-head"><h2>{t('overview.connections')}</h2><Link className="card-note" href="/dashboard/connections" prefetch={false}>{t('common.manage')}</Link></div>
              <div className="card-body stack">
                {connections.map((connection) => (
                  <div key={connection.provider} className="connection-top">
                    <Provider name={connection.provider} />
                    <StatusPill status={connection.status} label={t(`common.status_${connection.status}`)} />
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>{t('overview.governance')}</h2></div>
              <div className="card-body">
                <dl className="connection-meta" style={{ margin: 0 }}>
                  <div><dt>{t('overview.awaitingApproval')}</dt><dd><Link href="/dashboard/approvals" prefetch={false}>{tn('overview.operations', pending.length)}{pending.length === 5 ? '+' : ''}</Link></dd></div>
                  <div><dt>{t('overview.auditEvents')}</dt><dd><Link href="/dashboard/audit" prefetch={false}>{auditCount}</Link></dd></div>
                </dl>
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
