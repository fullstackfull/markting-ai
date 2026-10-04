import { PageHeader } from '@/components/ui';
import { canAdminister, requireDashboardTenant } from '@/lib/cloud/dashboard';
import { providerLabel } from '@/lib/cloud/providers';
import { listCanonicalConnections } from '@/lib/connections/read';
import { ConnectionCenter } from './connection-center';
import { isSyntheticReviewer } from '@/lib/cloud/synthetic-reviewer';
import { SyntheticReviewer } from '@/components/synthetic-reviewer';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Connections' };

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const tenant = await requireDashboardTenant();
  if (isSyntheticReviewer(tenant.organizationId)) return <SyntheticReviewer tenant={tenant} />;
  const [connections, params] = await Promise.all([listCanonicalConnections(tenant.organizationId), searchParams]);
  const { t } = await getT();
  return (
    <main className="page">
      <PageHeader title={t('connections.title')} description={t('connections.description')} />
      <div className="stack" style={{ marginBottom: '0.9rem' }}>
        {params.connected ? <div className="callout success">{t('connections.connectedNotice', { provider: providerLabel(params.connected) })}</div> : null}
        {params.error ? <div className="error-callout" style={{ marginBottom: 0 }}>{params.error}</div> : null}
      </div>
      <ConnectionCenter
        organizationId={tenant.organizationId}
        canManage={canAdminister(tenant)}
        connections={connections}
      />
    </main>
  );
}
