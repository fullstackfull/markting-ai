'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { Policy } from '@adport/core';
import { PlanLimitModal } from '@/components/plan-limit-modal';
import { Provider } from '@/components/ui';
import { useI18n } from '@/components/i18n-provider';
import { planLimitFromResponse, type PlanLimitDetails } from '@/lib/cloud/plan-limit';

interface PolicyAccount {
  provider: string;
  accountId: string;
  name: string;
  currency: string | null;
  status: string | null;
  enabled: boolean;
}

export function PolicyForm({ organizationId, canAdminister, policy, dataRetentionDays, planName, maxRetentionDays, writeAccess, accounts }: {
  organizationId: string;
  canAdminister: boolean;
  policy: Policy;
  dataRetentionDays: number;
  planName: string;
  maxRetentionDays: number;
  writeAccess: boolean;
  accounts: PolicyAccount[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [busy, setBusy] = useState(false);
  const [planLimit, setPlanLimit] = useState<PlanLimitDetails>();
  const discoveredAccountIds = new Set(accounts.map((account) => account.accountId));
  const manualProtectedAccounts = policy.protected_accounts.filter((accountId) => !discoveredAccountIds.has(accountId));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage({});
    const formData = new FormData(event.currentTarget);
    const data = Object.fromEntries(formData.entries());
    const numberOrNull = (value: FormDataEntryValue | undefined) => value === undefined || value === '' ? null : Number(value);
    const maxDailyBudget = numberOrNull(data.maxDailyBudget);
    const response = await fetch('/api/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        organizationId,
        dataRetentionDays: Number(data.dataRetentionDays),
        policy: {
          require_validation: true,
          paused_creation: data.pausedCreation === 'on',
          max_budget_delta_pct: numberOrNull(data.maxBudgetDeltaPct),
          max_daily_budget_micros: maxDailyBudget === null ? null : Math.round(maxDailyBudget * 1_000_000),
          protected_accounts: [...new Set([
            ...formData.getAll('protectedAccount').map(String),
            ...String(data.manualProtectedAccounts ?? '').split(',').map((item) => item.trim()).filter(Boolean),
          ])],
          pending_ttl_minutes: Number(data.pendingTtlMinutes),
        },
      }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    const limit = planLimitFromResponse(result);
    if (limit) setPlanLimit(limit);
    else if (!response.ok) setMessage({ error: result.error ?? t('policies.saveFailed') });
    else { setMessage({ success: t('policies.saved') }); router.refresh(); }
    setBusy(false);
  }

  return (
    <form className="form" onSubmit={(event) => void save(event)}>
      <PlanLimitModal limit={planLimit} onClose={() => setPlanLimit(undefined)} />
      {message.error ? <div className="error-callout" style={{ marginBottom: 0 }}>{message.error}</div> : null}
      {message.success ? <div className="callout success">{message.success}</div> : null}
      <fieldset className="form" disabled={!canAdminister} style={{ border: 0, margin: 0, padding: 0 }}>
        {!writeAccess ? <div className="policy-plan-note"><div><strong>{t('policies.planReadOnly', { plan: planName })}</strong><p>{t('policies.planReadOnlyCopy')}</p></div><Link className="button secondary small" href="/dashboard/billing">{t('policies.seePlans')}</Link></div> : null}
        <section className="policy-section">
          <div className="policy-section-copy"><span className="plan-kicker">{t('policies.approvalGuardKicker')}</span><h3>{t('policies.approvalGuardTitle')}</h3><p>{t('policies.approvalGuardCopy')}</p></div>
          <div className="policy-controls">
            <div><label className="check locked"><input type="checkbox" checked readOnly /> {t('policies.previewRequired')}</label><p className="field-hint policy-indent">{t('policies.previewRequiredHint')}</p></div>
            <label className="check"><input name="pausedCreation" type="checkbox" defaultChecked={policy.paused_creation} /> {t('policies.forcePaused')}</label>
          </div>
        </section>
        <section className="policy-section">
          <div className="policy-section-copy"><span className="plan-kicker">{t('policies.budgetKicker')}</span><h3>{t('policies.budgetTitle')}</h3><p>{t('policies.budgetCopy')}</p></div>
          <div className="field-grid policy-controls">
            <label className="field">
              <span>{t('policies.maxBudgetChange')}</span>
              <input name="maxBudgetDeltaPct" type="number" min="0.01" step="0.01" defaultValue={policy.max_budget_delta_pct ?? ''} placeholder={t('policies.noLimit')} />
              <span className="field-hint">{t('policies.maxBudgetChangeHint')}</span>
            </label>
            <label className="field">
              <span>{t('policies.maxDailyBudget')}</span>
              <input name="maxDailyBudget" type="number" min="0.01" step="0.01" defaultValue={policy.max_daily_budget_micros === null || policy.max_daily_budget_micros === undefined ? '' : policy.max_daily_budget_micros / 1_000_000} placeholder={t('policies.noLimit')} />
              <span className="field-hint">{t('policies.maxDailyBudgetHint')}</span>
            </label>
          </div>
        </section>
        <section className="policy-section">
          <div className="policy-section-copy"><span className="plan-kicker">{t('policies.evidenceKicker')}</span><h3>{t('policies.evidenceTitle')}</h3><p>{t('policies.evidenceCopy')}</p></div>
          <div className="field-grid policy-controls">
            <label className="field">
              <span>{t('policies.approvalLifetime')}</span>
              <input name="pendingTtlMinutes" type="number" min="1" step="1" defaultValue={policy.pending_ttl_minutes} required />
              <span className="field-hint">{t('policies.approvalLifetimeHint')}</span>
            </label>
            <label className="field">
              <span>{t('policies.dataRetention')}</span>
              <input name="dataRetentionDays" type="number" min="1" max="3650" step="1" defaultValue={dataRetentionDays} required />
              <span className="field-hint">{t('policies.dataRetentionHint', { plan: planName, days: maxRetentionDays })}</span>
            </label>
          </div>
        </section>
        <section className="policy-section protected-section">
          <div className="policy-section-copy"><span className="plan-kicker">{t('policies.protectedKicker')}</span><h3>{t('policies.protectedTitle')}</h3><p>{t('policies.protectedCopy')}</p></div>
          <div className="policy-controls">
            {accounts.length > 0 ? <div className="policy-account-list">
              {accounts.map((account) => (
                <label className="policy-account" key={`${account.provider}:${account.accountId}`}>
                  <input name="protectedAccount" type="checkbox" value={account.accountId} defaultChecked={policy.protected_accounts.includes(account.accountId)} />
                  <Provider name={account.provider} />
                  <span className="policy-account-copy"><strong>{account.name}</strong><small>{account.accountId}{account.currency ? ` · ${account.currency}` : ''}</small></span>
                  <span className={`status ${account.enabled ? '' : 'neutral'}`}>{account.enabled ? t('policies.accountActive') : t('policies.accountInactive')}</span>
                </label>
              ))}
            </div> : <div className="inline-note">{t('policies.noAccountsDiscovered')}</div>}
            <label className="field">
              <span>{t('policies.otherAccountIds')}</span>
              <input name="manualProtectedAccounts" defaultValue={manualProtectedAccounts.join(', ')} placeholder={t('policies.otherAccountIdsPlaceholder')} />
              <span className="field-hint">{t('policies.otherAccountIdsHint')}</span>
            </label>
          </div>
        </section>
        {canAdminister ? <div className="form-actions"><button className="button" disabled={busy}>{busy ? t('policies.saving') : t('policies.savePolicy')}</button></div> : <p className="inline-note">{t('policies.adminsOnly')}</p>}
      </fieldset>
    </form>
  );
}
