import { PageHeader } from '@/components/ui';
import { billingConfigured, billingPlanConfigured } from '@/lib/cloud/billing';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import {
  getOrganizationEntitlement,
  PLANS,
  type BillingInterval,
  type PlanId,
} from '@/lib/cloud/plans';
import { getT } from '@/lib/i18n/server';
import { openBillingPortal, startSubscription } from './actions';

export const metadata = { title: 'Plan' };

const PLAN_ORDER: PlanId[] = ['reader', 'operator', 'premium', 'agency'];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; billing?: string }>;
}) {
  const [tenant, query, { t, tn }] = await Promise.all([requireDashboardTenant(), searchParams, getT()]);
  const entitlement = await getOrganizationEntitlement(tenant.organizationId);
  const configured = billingConfigured();
  const canManage = tenant.role === 'owner';
  const interval: BillingInterval = query.billing === 'annual' ? 'annual' : 'monthly';

  return (
    <main className="page plan-page">
      <PageHeader
        title={t('billing.title')}
        description={t('billing.description')}
      />
      {query.checkout === 'complete' ? <div className="callout success plan-notice">{t('billing.checkoutComplete')}</div> : null}
      {query.checkout === 'canceled' ? <div className="callout plan-notice">{t('billing.checkoutCanceled')}</div> : null}

      <section className="plan-summary">
        <div>
          <span className="plan-kicker">{t('billing.currentWorkspace')}</span>
          <div className="plan-current-line">
            <strong>{t(`billing.plan_${entitlement.plan.id}_name`)}</strong>
            <span className="status">{t(`billing.status_${entitlement.status}`)}</span>
          </div>
          <p>{t('billing.summaryNote')}</p>
        </div>
        {entitlement.providerCustomerId && canManage && configured ? (
          <form action={openBillingPortal}><button className="button secondary" type="submit">{t('billing.manageBilling')}</button></form>
        ) : null}
      </section>

      <div className="plan-toolbar" aria-label={t('billing.intervalLabel')}>
        <div className="billing-toggle">
          <a className={interval === 'monthly' ? 'active' : ''} href="?billing=monthly">{t('billing.monthly')}</a>
          <a className={interval === 'annual' ? 'active' : ''} href="?billing=annual">{t('billing.yearly')}</a>
        </div>
        <span className="annual-saving">{t('billing.yearlySaving')}</span>
      </div>

      <div className="plan-grid">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const selected = entitlement.plan.id === planId;
          const paid = plan.id === 'operator' || plan.id === 'premium' || plan.id === 'agency';
          const paidPlanReady = plan.id === 'operator' || plan.id === 'premium' || plan.id === 'agency'
            ? billingPlanConfigured(plan.id, interval)
            : false;
          const annual = interval === 'annual' && paid;
          const displayPrice = annual ? Math.round((plan.annualPriceEur! / 12) * 100) / 100 : plan.monthlyPriceEur;
          const annualSaving = paid ? (plan.monthlyPriceEur! * 12) - plan.annualPriceEur! : 0;

          return (
            <section className={`plan-card${plan.id === 'premium' ? ' featured' : ''}${selected ? ' selected' : ''}`} key={plan.id}>
              <div className="plan-card-top">
                <span className="plan-kicker">{t(`billing.plan_${plan.id}_eyebrow`)}</span>
                {plan.id === 'premium' ? <span className="plan-badge">{t('billing.bestValue')}</span> : selected ? <span className="plan-badge neutral">{t('billing.currentPlan')}</span> : null}
                <h2>{t(`billing.plan_${plan.id}_name`)}</h2>
                <p>{t(`billing.plan_${plan.id}_description`)}</p>
              </div>
              <div className="plan-price">
                {plan.monthlyPriceEur === 0 ? (
                  <><strong>€0</strong><span>{t('billing.forever')}</span></>
                ) : (
                  <>
                    <strong>€{displayPrice}</strong><span>{t('billing.perMonth')}</span>
                    {annual ? <small>{t('billing.billedYearly', { total: plan.annualPriceEur!, saving: annualSaving })}</small> : <small>{t('billing.billedMonthly')}</small>}
                    <small className="plan-trial">{t('billing.trialNote')}</small>
                  </>
                )}
              </div>
              <ul className="plan-features">
                <li>{plan.maxActiveAccounts === null ? t('billing.unlimitedActiveAccounts') : tn('billing.activeAccounts', plan.maxActiveAccounts)}</li>
                <li>{plan.maxMembers === null ? t('billing.unlimitedMembers') : tn('billing.members', plan.maxMembers)}</li>
                <li>{t('billing.auditHistory', { days: plan.maxRetentionDays })}</li>
                <li>{plan.writeAccess ? t('billing.featureWrite') : t('billing.featureReadOnly')}</li>
                {plan.clientWorkspaces ? <li>{t('billing.featureClientWorkspaces')}</li> : null}
              </ul>
              <div className="plan-action">
                {selected ? <span className="button secondary full disabled">{t('billing.currentPlan')}</span> : null}
                {!selected && paid && canManage && paidPlanReady && !entitlement.providerSubscriptionId ? (
                  <form action={startSubscription.bind(null, plan.id, interval)}>
                    <button className="button full" type="submit">{t('billing.startTrial')}</button>
                  </form>
                ) : null}
                {!selected && paid && configured && !paidPlanReady ? <span className="plan-unavailable">{t('billing.checkoutSoon')}</span> : null}
                {!selected && paid && !canManage ? <span className="plan-unavailable">{t('billing.askOwner')}</span> : null}
                {!selected && paid && entitlement.providerSubscriptionId ? <span className="plan-unavailable">{t('billing.managePortal')}</span> : null}
              </div>
            </section>
          );
        })}
      </div>

      <section className="enterprise-card">
        <div>
          <span className="plan-kicker">{t('billing.plan_enterprise_eyebrow')}</span>
          <h2>{t('billing.plan_enterprise_name')}</h2>
          <p>{t('billing.plan_enterprise_description')} {t('billing.enterpriseIncludes')}</p>
        </div>
        <a className="button secondary" href="mailto:yannick@adport.dev?subject=Adport%20Enterprise">{t('billing.talkToAdport')}</a>
      </section>
      {!configured ? <p className="inline-note" style={{ marginTop: '0.9rem' }}>{t('billing.notConfigured')}</p> : null}
    </main>
  );
}
