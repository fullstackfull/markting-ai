import { PageHeader } from '@/components/ui';
import { canAdminister, requireDashboardTenant } from '@/lib/cloud/dashboard';
import { oauthAvailability } from '@/lib/cloud/provider-oauth';
import { providerLabel } from '@/lib/cloud/providers';
import { listConnections } from '@/lib/cloud/repository';
import { OAUTH_PROVIDERS } from '@/lib/cloud/types';
import { ProviderConnections, type OAuthProviderView } from './provider-connections';
import { isSyntheticReviewer } from '@/lib/cloud/synthetic-reviewer';
import { SyntheticReviewer } from '@/components/synthetic-reviewer';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Connections' };

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const tenant = await requireDashboardTenant();
  if (isSyntheticReviewer(tenant.organizationId)) return <SyntheticReviewer tenant={tenant} />;
  const [connections, params] = await Promise.all([listConnections(tenant.organizationId), searchParams]);
  const availability = oauthAvailability(tenant.organizationId);
  const oauthProviders: OAuthProviderView[] = OAUTH_PROVIDERS.map((id) => ({ id, available: availability[id] }));
  const { t } = await getT();
  return (
    <main className="page">
      <PageHeader
        title={t('connections.title')}
        description={t('connections.description')}
      />
      <div className="stack" style={{ marginBottom: '0.9rem' }}>
        {params.connected ? <div className="callout success">{t('connections.connectedNotice', { provider: providerLabel(params.connected) })}</div> : null}
        {params.error ? <div className="error-callout" style={{ marginBottom: 0 }}>{params.error}</div> : null}
      </div>
      <ProviderConnections
        organizationId={tenant.organizationId}
        canManage={canAdminister(tenant)}
        connections={connections.map((connection) => ({
          provider: connection.provider,
          status: connection.status,
          accountSelectionId: connection.accountSelectionId,
          externalLabel: connection.externalLabel,
          lastError: connection.lastError,
          connectedAt: connection.connectedAt.toISOString(),
          lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
        }))}
        oauthProviders={oauthProviders}
      />
    </main>
  );
}
