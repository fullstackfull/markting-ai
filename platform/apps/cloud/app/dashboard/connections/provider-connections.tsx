'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Provider, StatusPill, formatDate } from '@/components/ui';
import { providerLabel } from '@/lib/cloud/providers';
import type { OAuthProvider } from '@/lib/cloud/types';
import { OAuthPopupLink } from '@/components/oauth-popup-link';
import { useI18n } from '@/components/i18n-provider';
import type { PluralTranslator, Translator } from '@/lib/i18n';

export interface ConnectionView {
  provider: string;
  status: 'connected' | 'error' | 'revoked';
  externalLabel: string | null;
  lastError: string | null;
  connectedAt: string;
  lastVerifiedAt: string | null;
  accountSelectionId?: string | null;
}

export interface OAuthProviderView {
  id: OAuthProvider;
  available: boolean;
}

export function ProviderConnections({ organizationId, canManage, connections, oauthProviders, returnTo }: {
  organizationId: string;
  canManage: boolean;
  connections: ConnectionView[];
  oauthProviders: OAuthProviderView[];
  returnTo?: string;
}) {
  const router = useRouter();
  const { t, tn, locale } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Partial<Record<string, { error?: string; success?: string }>>>({});

  function find(provider: string): ConnectionView | undefined {
    return connections.find((connection) => connection.provider === provider);
  }

  async function disconnect(provider: string, label: string) {
    const prompt = t('connections.disconnectConfirm', { label });
    if (!window.confirm(prompt)) return;
    setBusy(provider);
    setNotice((current) => ({ ...current, [provider]: {} }));
    const response = await fetch(`/api/connections/${provider}?organization_id=${organizationId}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({})) as { error?: string; providerRevocationRequired?: boolean };
    if (!response.ok) {
      setNotice((current) => ({ ...current, [provider]: { error: result.error ?? t('connections.disconnectFailed', { label }) } }));
    } else {
      setNotice((current) => ({
        ...current,
        [provider]: { success: result.providerRevocationRequired ? t('connections.removedRevokeManually', { label }) : t('connections.disconnectedRevoked', { label }) },
      }));
      router.refresh();
    }
    setBusy(undefined);
  }

  return (
    <section aria-label={t('connections.sectionLabel')}>
      {!canManage ? <p className="inline-note">{t('connections.adminsOnly')}</p> : null}
      <div className="connection-list">
      <div className="connection-list-heading" aria-hidden="true"><span>{t('connections.colPlatform')}</span><span>{t('connections.colStatus')}</span><span>{t('connections.colAccounts')}</span><span>{t('connections.colActions')}</span></div>
      <ul className="connection-rows" role="list">
      {oauthProviders.map((provider) => {
        const connection = find(provider.id);
        const message = notice[provider.id];
        const startHref = `/api/oauth/${provider.id}/start?organization_id=${organizationId}${returnTo ? `&return_to=${encodeURIComponent(returnTo)}` : ''}`;
        return (
          <li className="connection-row" key={provider.id} aria-label={providerLabel(provider.id)}>
            <Provider name={provider.id} />
            <div className="connection-status" title={connection ? t('connections.lastVerified', { date: formatDate(connection.lastVerifiedAt ?? connection.connectedAt, locale) }) : undefined}>
              {connection?.accountSelectionId && connection.status === 'connected' ? <span className="status neutral">{t('connections.chooseAccounts')}</span> : connection ? <StatusPill status={connection.status} label={t(`common.status_${connection.status}`)} /> : <span className="status neutral">{provider.available ? t('connections.notConnected') : t('connections.unavailable')}</span>}
            </div>
            <div className="connection-accounts">
              {connection?.accountSelectionId && connection.status === 'connected' ? (
                canManage ? <a href={`/account-selection?selection_id=${connection.accountSelectionId}`}>{t('connections.finishSelection')}</a> : <span>{t('connections.selectionPending')}</span>
              ) : connection?.status === 'connected' ? (
                <a href={`/dashboard/accounts?select_provider=${provider.id}`} aria-label={t('connections.viewProviderAccounts', { provider: providerLabel(provider.id) })}>
                  {accountSummary(connection.externalLabel, t, tn)}
                </a>
              ) : <span>{connection ? t('connections.reconnectToVerify') : t('common.none')}</span>}
            </div>
            <div className="connection-actions">
            {canManage ? (
              connection || provider.available ? (
                <>
                  {!connection && provider.available ? <OAuthPopupLink className="button" label={t('connections.connectProvider', { provider: providerLabel(provider.id) })} href={startHref}>{t('connections.connect')}</OAuthPopupLink> : null}
                  {connection && provider.available ? <OAuthPopupLink className="button secondary" label={t(connection.status !== 'connected' ? 'connections.reconnectProvider' : 'connections.reauthorizeProvider', { provider: providerLabel(provider.id) })} href={startHref}>{connection.status !== 'connected' ? t('connections.reconnect') : t('connections.reauthorize')}</OAuthPopupLink> : null}
                  {connection ? <button className="button danger" aria-label={t('connections.disconnectProvider', { provider: providerLabel(provider.id) })} type="button" disabled={busy === provider.id} onClick={() => void disconnect(provider.id, shortLabel(provider.id))}>{busy === provider.id ? t('connections.working') : t('connections.disconnect')}</button> : null}
                </>
              ) : null
            ) : (
              <span className="inline-note">{t('connections.viewOnly')}</span>
            )}
            </div>
            {connection?.status === 'error' ? <div className="error-callout connection-feedback" role="alert">{connection.lastError ?? t('connections.verificationFailed')}</div> : null}
            {message?.error ? <div className="error-callout connection-feedback" role="alert">{message.error}</div> : null}
            {message?.success ? <div className="callout success connection-feedback" role="status">{message.success}</div> : null}
          </li>
        );
      })}
      </ul>
      </div>
    </section>
  );
}

function accountSummary(label: string | null, t: Translator, tn: PluralTranslator): string {
  const count = label?.match(/^(\d+) (?:accessible|added) .+ account\(s\)$/)?.[1];
  return count ? tn('connections.accounts', Number(count)) : label ?? t('connections.viewAccounts');
}

function shortLabel(provider: string): string {
  return { google: 'Google Ads', meta: 'Meta', tiktok: 'TikTok', microsoft: 'Microsoft', reddit: 'Reddit', apple: 'Apple Ads', snapchat: 'Snapchat', spotify: 'Spotify', pinterest: 'Pinterest', linkedin: 'LinkedIn', x: 'X Ads' }[provider] ?? provider;
}
