import Link from 'next/link';
import { z } from 'zod';
import { PageHeader } from '@/components/ui';
import { BrandLockup } from '@/components/logos';
import { requireDashboardTenant, canAdminister } from '@/lib/cloud/dashboard';
import { getAccountSelection } from '@/lib/cloud/account-selection';
import { listOrganizationAdAccounts } from '@/lib/cloud/repository';
import { providerLabel } from '@/lib/cloud/providers';
import { ProviderAccountPicker } from './provider-account-picker';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Add accounts' };

export default async function SelectAccountsPage({ searchParams }: { searchParams: Promise<{ selection_id?: string }> }) {
  const tenant = await requireDashboardTenant();
  const { selection_id } = await searchParams;
  const { t } = await getT();
  const id = z.string().uuid().safeParse(selection_id);
  const selection = canAdminister(tenant) && id.success
    ? await getAccountSelection({ ...tenant, scopes: [] }, id.data) : undefined;
  if (!selection) return <main className="page">
    <PageHeader title={t('accounts.unavailableTitle')} description={t('accounts.unavailableCopy')} />
    <Link href="/dashboard/connections" className="button">{t('accounts.openConnections')}</Link>
  </main>;
  const inventory = await listOrganizationAdAccounts(tenant.organizationId);
  return <main className="onboarding-page">
    <header className="onboarding-head"><BrandLockup /><span>{tenant.organizationName}</span></header>
    <div className="account-selection-content">
    <PageHeader title={t('accounts.addProviderAccounts', { provider: providerLabel(selection.provider) })} description={selection.accounts.length === 1 ? t('accounts.singleDescription') : t('accounts.multiDescription')} />
    <ProviderAccountPicker organizationId={tenant.organizationId} selectionId={selection.id}
      provider={selection.provider} accounts={selection.accounts}
      pages={selection.pages}
      initialSelectedIds={inventory.filter(account => account.provider === selection.provider).map(account => account.accountId)} />
    </div>
  </main>;
}
