import Link from 'next/link';
import { Empty, PageHeader, Provider } from '@/components/ui';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { getOrganizationEntitlement } from '@/lib/cloud/plans';
import { listConnections, listOrganizationAdAccounts } from '@/lib/cloud/repository';
import { providerLabel } from '@/lib/cloud/providers';
import { isOAuthProvider } from '@/lib/cloud/types';
import { AccountAccessManager } from './account-access-manager';
import { isSyntheticReviewer } from '@/lib/cloud/synthetic-reviewer';
import { SyntheticReviewer } from '@/components/synthetic-reviewer';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Accounts' };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; accounts_saved?: string; error?: string; select_provider?: string }> }) {
  const tenant = await requireDashboardTenant();
  if (isSyntheticReviewer(tenant.organizationId)) return <SyntheticReviewer tenant={tenant} />;
  const [connections, inventory, entitlement, params] = await Promise.all([
    listConnections(tenant.organizationId),
    listOrganizationAdAccounts(tenant.organizationId),
    getOrganizationEntitlement(tenant.organizationId),
    searchParams,
  ]);
  const requestedProvider = params.select_provider ?? params.connected;
  const providerFilter = requestedProvider && isOAuthProvider(requestedProvider) ? requestedProvider : undefined;
  const { t } = await getT();
  const pendingConnections = connections.filter(connection => connection.accountSelectionId && connection.status === 'connected' && (!providerFilter || connection.provider === providerFilter));
  return (
    <main className="page">
      <PageHeader title={providerFilter ? t('accounts.providerAccountsTitle', { provider: providerLabel(providerFilter) }) : t('accounts.title')} description={t('accounts.description')} />
      {providerFilter ? <Link className="button secondary small" href="/dashboard/accounts" style={{ marginBottom: '1rem' }}>{t('accounts.viewAllProviders')}</Link> : null}
      {params.connected ? <div className="callout success" style={{ marginBottom: '1rem' }}>{t('accounts.connectedNotice', { provider: providerLabel(params.connected) })}</div> : null}
      {params.accounts_saved ? <div className="callout success" role="status" style={{ marginBottom: '1rem' }}>{t('accounts.savedNotice')}</div> : null}
      {params.error ? <div className="error-callout" role="alert">{params.error}</div> : null}
      {inventory.length === 0 && !providerFilter ? <section className="card">
        <Empty
          title={t('accounts.emptyTitle')}
          copy={t('accounts.emptyCopy')}
          href="/dashboard/connections"
          action={t('accounts.openConnections')}
        />
      </section> : (
        <AccountAccessManager
          organizationId={tenant.organizationId}
          accounts={inventory}
          canManage={['owner', 'admin'].includes(tenant.role)}
          maxActiveAccounts={entitlement.plan.maxActiveAccounts}
          providerFilter={providerFilter}
        />
      )}
      {pendingConnections.length > 0 ? (
        <section className="card" style={{ marginTop: '0.9rem' }}>
          <div className="card-head"><h2>{t('accounts.finishSelectionTitle')}</h2><span className="card-note">{t('accounts.agentAccessPaused')}</span></div>
          <div className="row-list">
            {pendingConnections.map((connection) => (
              <div className="row-item" key={connection.provider}>
                <div>
                  <Provider name={connection.provider} />
                  <div className="cell-sub">{t('accounts.finishSelectionCopy')}</div>
                </div>
                <Link className="button secondary small" href={`/account-selection?selection_id=${connection.accountSelectionId}`}>{t('accounts.chooseAccounts')}</Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
