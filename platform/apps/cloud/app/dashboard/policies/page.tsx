import { policySchema } from '@adport/core';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { canAdminister, requireDashboardTenant } from '@/lib/cloud/dashboard';
import { getOrganizationEntitlement } from '@/lib/cloud/plans';
import { listOrganizationAdAccounts } from '@/lib/cloud/repository';
import { db } from '@/lib/db';
import { PolicyForm } from './policy-form';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Policies' };

export default async function PoliciesPage() {
  const tenant = await requireDashboardTenant();
  const [settings, accounts, entitlement] = await Promise.all([
    db()<Array<{ policy: unknown; dataRetentionDays: number }>>`
      select policy, data_retention_days from public.organization_settings where organization_id = ${tenant.organizationId}
    `,
    listOrganizationAdAccounts(tenant.organizationId),
    getOrganizationEntitlement(tenant.organizationId),
  ]);
  const policy = policySchema.parse(settings[0]?.policy ?? {});
  const dataRetentionDays = settings[0]?.dataRetentionDays ?? 90;
  const { t, tn } = await getT();
  return (
    <main className="page policy-page">
      <PageHeader title={t('policies.title')} description={t('policies.description')}
        action={<Link className="button secondary" href="/dashboard/accounts" prefetch={false}>{t('policies.manageAccounts')}</Link>} />
      <section className="policy-overview" aria-label={t('policies.coverage')}>
        <div><span>{t('policies.enforcement')}</span><strong><i className="policy-dot" />{t('policies.alwaysOn')}</strong><small>{t('policies.previewPlusApproval')}</small></div>
        <div><span>{t('policies.accountScope')}</span><strong>{tn('policies.active', accounts.filter((account) => account.enabled).length)}</strong><small>{tn('policies.discovered', accounts.length)}</small></div>
        <div><span>{t('policies.currentPlan')}</span><strong>{entitlement.plan.name}</strong><small>{entitlement.plan.writeAccess ? t('policies.guardedReadWrite') : t('policies.readOnlyAgentAccess')}</small></div>
      </section>
      <section className="card policy-card">
        <div className="card-head"><div><h2>{t('policies.workspacePolicy')}</h2><p className="card-kicker">{t('policies.changesApplyImmediately')}</p></div><span className="status">{t('policies.enforced')}</span></div>
        <div className="card-body">
          <PolicyForm
            organizationId={tenant.organizationId}
            canAdminister={canAdminister(tenant)}
            policy={policy}
            dataRetentionDays={dataRetentionDays}
            planName={entitlement.plan.name}
            maxRetentionDays={entitlement.plan.maxRetentionDays}
            writeAccess={entitlement.plan.writeAccess}
            accounts={accounts.map((account) => ({
              provider: account.provider, accountId: account.accountId, name: account.name,
              currency: account.currency, status: account.status, enabled: account.enabled,
            }))}
          />
        </div>
      </section>
    </main>
  );
}
