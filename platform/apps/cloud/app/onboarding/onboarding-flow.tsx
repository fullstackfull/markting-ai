'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isOAuthProvider, type OAuthProvider } from '@/lib/cloud/types';
import { providerLabel } from '@/lib/cloud/providers';
import { useI18n } from '@/components/i18n-provider';
import { AccountAccessManager, type AccountAccessItem } from '../dashboard/accounts/account-access-manager';
import { AgentSetupGuide } from '../dashboard/agents/agent-setup-guide';
import { ProviderConnections, type ConnectionView, type OAuthProviderView } from '../dashboard/connections/provider-connections';

type Step = 'welcome' | 'connect' | 'accounts' | 'agent' | 'complete';

const STEPS: Step[] = ['welcome', 'connect', 'accounts', 'agent'];

export function OnboardingFlow({ organizationId, canManage, initialStep, initialAgent, baseUrl, connectedProvider, oauthError, providers, connections, accounts, maxActiveAccounts }: {
  organizationId: string;
  canManage: boolean;
  initialStep: Step;
  initialAgent: string | null;
  baseUrl: string;
  connectedProvider?: string;
  oauthError?: string;
  providers: OAuthProviderView[];
  connections: ConnectionView[];
  accounts: AccountAccessItem[];
  maxActiveAccounts: number | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(connectedProvider ? 'accounts' : initialStep === 'complete' ? 'welcome' : initialStep);
  const [agent, setAgent] = useState(initialAgent ?? 'chatgpt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [providerFilter, setProviderFilter] = useState<OAuthProvider | undefined>(connectedProvider && isOAuthProvider(connectedProvider) ? connectedProvider : undefined);

  async function advance(next: Step, complete = false) {
    setBusy(true);
    setError(undefined);
    const response = await fetch('/api/onboarding', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentStep: next, selectedAgent: next === 'complete' || next === 'agent' ? agent : undefined, complete }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(result.error ?? t('onboarding.saveFailed'));
    else if (complete) { router.push('/dashboard'); router.refresh(); }
    else {
      if (step === 'accounts' && next !== 'accounts') setProviderFilter(undefined);
      setStep(next);
    }
    setBusy(false);
  }

  const activeIndex = Math.max(0, STEPS.indexOf(step));
  return (
    <div className="onboarding-shell">
      <ol className="onboarding-progress" aria-label={t('onboarding.progressLabel')}>
        {STEPS.map((item, index) => <li key={item} data-active={item === step} data-complete={index < activeIndex}><span>{index + 1}</span>{t(`onboarding.step_${item}`)}</li>)}
      </ol>
      {error ? <div className="error-callout" role="alert">{error}</div> : null}
      {oauthError ? <div className="error-callout" role="alert">{oauthError}</div> : null}

      {step === 'welcome' ? <section className="onboarding-hero">
        <span className="plan-kicker">{t('onboarding.aboutTime')}</span>
        <h1>{t('onboarding.heroTitle')}</h1>
        <p>{t('onboarding.heroCopy')}</p>
        <div className="onboarding-points"><span>{t('onboarding.pointEncrypted')}</span><span>{t('onboarding.pointPreview')}</span><span>{t('onboarding.pointPaused')}</span></div>
        <button className="button" disabled={busy} onClick={() => void advance('connect')}>{t('onboarding.startSetup')}</button>
      </section> : null}

      {step === 'connect' ? <section className="onboarding-stage">
        <div className="onboarding-title"><span className="plan-kicker">{t('onboarding.stepLabel', { step: 2 })}</span><h1>{t('onboarding.connectTitle')}</h1><p>{t('onboarding.connectCopy')}</p></div>
        <ProviderConnections organizationId={organizationId} canManage={canManage} connections={connections} oauthProviders={providers} returnTo="/onboarding" />
        <div className="onboarding-actions"><button className="button" disabled={busy} onClick={() => void advance('accounts')}>{connections.length ? t('onboarding.chooseAccounts') : t('onboarding.continueWithout')}</button><button className="button secondary" onClick={() => void advance('welcome')}>{t('onboarding.back')}</button></div>
      </section> : null}

      {step === 'accounts' ? <section className="onboarding-stage">
        <div className="onboarding-title"><span className="plan-kicker">{t('onboarding.stepLabel', { step: 3 })}</span><h1>{providerFilter ? t('onboarding.chooseProviderAccounts', { provider: providerLabel(providerFilter) }) : t('onboarding.accountsTitle')}</h1><p>{t('onboarding.accountsCopy')}</p></div>
        {providerFilter ? <button className="button secondary small" onClick={() => setProviderFilter(undefined)}>{t('onboarding.viewAllProviders')}</button> : null}
        {accounts.length || providerFilter ? <AccountAccessManager organizationId={organizationId} accounts={accounts} canManage={canManage} maxActiveAccounts={maxActiveAccounts} providerFilter={providerFilter} /> : <div className="card"><div className="empty"><h2>{t('onboarding.noAccountsTitle')}</h2><p>{t('onboarding.noAccountsCopy')}</p></div></div>}
        <div className="onboarding-actions"><button className="button" disabled={busy} onClick={() => void advance('agent')}>{t('onboarding.connectAgent')}</button><button className="button secondary" onClick={() => void advance('connect')}>{t('onboarding.back')}</button></div>
      </section> : null}

      {step === 'agent' ? <section className="onboarding-stage">
        <div className="onboarding-title"><span className="plan-kicker">{t('onboarding.stepLabel', { step: 4 })}</span><h1>{t('onboarding.agentTitle')}</h1><p>{t('onboarding.agentCopy')}</p></div>
        <AgentSetupGuide baseUrl={baseUrl} initialSelectedId={agent} onSelectionChange={setAgent} />
        <div className="onboarding-actions"><button className="button" disabled={busy} onClick={() => void advance('complete', true)}>{busy ? t('onboarding.finishing') : t('onboarding.finishSetup')}</button><button className="button secondary" onClick={() => void advance('accounts')}>{t('onboarding.back')}</button></div>
      </section> : null}
    </div>
  );
}
