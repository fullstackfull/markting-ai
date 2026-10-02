'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Provider } from '@/components/ui';
import { PlanLimitModal } from '@/components/plan-limit-modal';
import { planLimitFromResponse, type PlanLimitDetails } from '@/lib/cloud/plan-limit';
import { providerLabel } from '@/lib/cloud/providers';
import type { OAuthProvider } from '@/lib/cloud/types';
import { useI18n } from '@/components/i18n-provider';

export interface AccountAccessItem {
  provider: string;
  accountId: string;
  name: string;
  currency: string | null;
  status: string | null;
  enabled: boolean;
}

export function AccountAccessManager({ organizationId, accounts, canManage, maxActiveAccounts, providerFilter }: {
  organizationId: string;
  accounts: AccountAccessItem[];
  canManage: boolean;
  maxActiveAccounts: number | null;
  providerFilter?: OAuthProvider;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [planLimit, setPlanLimit] = useState<PlanLimitDetails>();
  const activeCount = accounts.filter((account) => account.enabled).length;
  const visibleAccounts = providerFilter ? accounts.filter((account) => account.provider === providerFilter) : accounts;

  function setEnabled(account: AccountAccessItem, enabled: boolean) {
    setError(undefined);
    startTransition(async () => {
      const response = await fetch('/api/account-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, provider: account.provider, accountId: account.accountId, enabled }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      const limit = planLimitFromResponse(body);
      if (limit) setPlanLimit(limit);
      else if (!response.ok) setError(body.error ?? t('accounts.updateFailed'));
      else router.refresh();
    });
  }

  return (
    <section className="card">
      <PlanLimitModal limit={planLimit} onClose={() => setPlanLimit(undefined)} />
      <div className="card-head">
        <h2>{providerFilter ? t('accounts.providerAccessTitle', { provider: providerLabel(providerFilter) }) : t('accounts.agentAccessTitle')}</h2>
        <span className="card-note">{t(providerFilter ? 'accounts.activeNoteWorkspace' : 'accounts.activeNote', { active: activeCount, max: maxActiveAccounts ?? t('accounts.unlimited') })}</span>
      </div>
      {error ? <div className="error-callout" role="alert">{error}</div> : null}
      {visibleAccounts.length === 0 ? <div className="empty"><h3>{providerFilter ? t('accounts.noProviderAccounts', { provider: providerLabel(providerFilter) }) : t('accounts.noAccounts')}</h3><p>{t('accounts.reauthorizeHint')}</p></div> : <div className="table-wrap"><table>
        <thead><tr><th>{t('accounts.colAccount')}</th><th>{t('accounts.colProvider')}</th><th>{t('accounts.colCurrency')}</th><th>{t('accounts.colStatus')}</th><th>{t('accounts.colAgentAccess')}</th></tr></thead>
        <tbody>
          {visibleAccounts.map((account) => (
            <tr key={`${account.provider}:${account.accountId}`}>
              <td><strong>{account.name}</strong><div className="cell-sub">{account.accountId}</div></td>
              <td><Provider name={account.provider} /></td>
              <td>{account.currency ?? t('common.none')}</td>
              <td><span className="status neutral">{account.status ?? t('accounts.statusAvailable')}</span></td>
              <td>
                {canManage ? (
                  <button className={`button small ${account.enabled ? 'secondary' : ''}`} type="button" disabled={pending}
                    onClick={() => setEnabled(account, !account.enabled)}>
                    {account.enabled ? t('accounts.disable') : t('accounts.enable')}
                  </button>
                ) : <span className={`status ${account.enabled ? '' : 'neutral'}`}>{account.enabled ? t('accounts.active') : t('accounts.inactive')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>}
    </section>
  );
}
