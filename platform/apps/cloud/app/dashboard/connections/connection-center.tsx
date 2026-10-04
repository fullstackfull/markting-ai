'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';
import { Provider, formatDate } from '@/components/ui';
import { providerLabel } from '@/lib/cloud/providers';
import { OAuthPopupLink } from '@/components/oauth-popup-link';
import { useI18n } from '@/components/i18n-provider';
import { statusTone, healthTone } from '@/lib/connections/vocabulary';
import type { CanonicalConnection } from '@/lib/connections/types';
import { testConnection, discoverAccounts, retrySync, type TenantActionResult } from '@/lib/connections/tenant-actions';
import { ConnectionWizard } from './connection-wizard';

/**
 * Tenant Connection Center — one professional card per integration built on the canonical connection
 * model. Status/health/scopes/expiry/errors are shown honestly; every action is capability-gated by the
 * provider registry so an unsupported control is never offered. Sensitive actions are server-side,
 * RBAC-gated and audited.
 */
export function ConnectionCenter({ organizationId, canManage, connections }: {
  organizationId: string;
  canManage: boolean;
  connections: CanonicalConnection[];
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Partial<Record<string, { error?: string; success?: string }>>>({});
  const [wizard, setWizard] = useState<CanonicalConnection | null>(null);

  async function disconnect(provider: string, label: string) {
    if (!window.confirm(t('connections.disconnectConfirm', { label }))) return;
    setBusy(provider);
    setNotice((c) => ({ ...c, [provider]: {} }));
    const response = await fetch(`/api/connections/${provider}?organization_id=${organizationId}`, { method: 'DELETE' });
    const result = (await response.json().catch(() => ({}))) as { error?: string; providerRevocationRequired?: boolean };
    if (!response.ok) setNotice((c) => ({ ...c, [provider]: { error: result.error ?? t('connections.disconnectFailed', { label }) } }));
    else {
      setNotice((c) => ({ ...c, [provider]: { success: result.providerRevocationRequired ? t('connections.removedRevokeManually', { label }) : t('connections.disconnectedRevoked', { label }) } }));
      router.refresh();
    }
    setBusy(undefined);
  }

  return (
    <section aria-label={t('connections.sectionLabel')}>
      {!canManage ? <p className="inline-note">{t('connections.adminsOnly')}</p> : null}
      <div className="connection-cards" role="list">
        {connections.map((c) => (
          <ConnectionCard
            key={`${c.category}:${c.provider}:${c.id ?? 'none'}`}
            c={c}
            canManage={canManage}
            organizationId={organizationId}
            locale={locale}
            t={t}
            busy={busy === c.provider}
            notice={notice[c.provider]}
            onConnect={() => setWizard(c)}
            onDisconnect={() => void disconnect(c.provider, providerLabel(c.provider))}
          />
        ))}
      </div>
      {wizard ? <ConnectionWizard connection={wizard} organizationId={organizationId} onClose={() => setWizard(null)} /> : null}
    </section>
  );
}

function ConnectionCard({ c, canManage, organizationId, locale, t, busy, notice, onConnect, onDisconnect }: {
  c: CanonicalConnection; canManage: boolean; organizationId: string; locale: 'ar' | 'en';
  t: ReturnType<typeof useI18n>['t']; busy: boolean; notice?: { error?: string; success?: string };
  onConnect: () => void; onDisconnect: () => void;
}) {
  const connected = !!c.id;
  const startHref = `/api/oauth/${c.provider}/start?organization_id=${organizationId}`;
  const cap = c.capabilities;
  return (
    <article className="connection-card" role="listitem" aria-label={c.label}>
      <header className="connection-card-head">
        <Provider name={c.provider} />
        <span className="connection-card-title">{c.label}</span>
        <span className={`status ${statusTone(c.status)}`} title={c.statusReason}>{c.status}</span>
        {c.health ? <span className={`admin-tag ${healthTone(c.health)}`}>{c.health}</span> : null}
      </header>

      {c.reauthRequired ? <div className="callout warn" role="status">{t('connections.ccReauthBanner')}</div> : null}
      {c.disabledAt ? <div className="error-callout" role="alert">Disabled by a platform operator{c.disabledReason ? `: ${c.disabledReason}` : ''}.</div> : null}

      <dl className="connection-meta">
        <div><dt>{t('connections.colAccounts')}</dt><dd>{c.accountsEnabled}/{c.accountsTotal}</dd></div>
        <div><dt>{t('connections.ccEnvironment')}</dt><dd>{c.environment}</dd></div>
        <div><dt>{t('connections.ccAuthType')}</dt><dd>{c.authType ?? '—'}</dd></div>
        <div><dt>{t('connections.ccTokenExpiry')}</dt><dd>{c.tokenExpiresAt ? formatDate(c.tokenExpiresAt, locale) : t('connections.ccUnknown')}</dd></div>
        <div><dt>{t('connections.ccLastAuth')}</dt><dd>{c.lastAuthenticatedAt ? formatDate(c.lastAuthenticatedAt, locale) : t('connections.ccNever')}</dd></div>
        <div><dt>{t('connections.ccLastSync')}</dt><dd>{c.lastSyncAt ? formatDate(c.lastSyncAt, locale) : t('connections.ccNever')}</dd></div>
      </dl>

      {c.scopesGranted.length ? <p className="inline-note">{t('connections.ccScopesGranted')}: {c.scopesGranted.length}</p> : null}
      {c.missingScopes.length ? <div className="callout warn">{t('connections.ccScopesMissing')}: {c.missingScopes.join(', ')}</div> : null}
      {!c.liveTransportImplemented ? <p className="inline-note">{t('connections.ccNoLiveTransport')}</p> : null}

      {c.lastError ? (
        <div className="error-callout connection-feedback" role="alert">
          {c.lastError}
          {c.remediation ? <div className="inline-note">{t('connections.ccRecommended')}: {c.remediation.action} — {c.remediation.detail}</div> : null}
        </div>
      ) : null}

      {c.accountSelectionId && c.status !== 'NOT_CONFIGURED' ? (
        <a className="inline-link" href={`/account-selection?selection_id=${c.accountSelectionId}`}>{t('connections.finishSelection')}</a>
      ) : null}

      <div className="connection-actions">
        {!canManage ? <span className="inline-note">{t('connections.viewOnly')}</span> : (
          <>
            {!connected && c.available && cap.connect ? (
              <button type="button" className="button" onClick={onConnect}>{t('connections.connect')}</button>
            ) : null}
            {connected && c.available && cap.reauthorize ? (
              <OAuthPopupLink className="button secondary" label={t('connections.reauthorizeProvider', { provider: c.label })} href={startHref}>
                {c.status === 'CONNECTED' ? t('connections.reauthorize') : t('connections.reconnect')}
              </OAuthPopupLink>
            ) : null}
            {connected && cap.testConnection ? <ActionButton action={testConnection} provider={c.provider} label={t('connections.ccTest')} busy={busy} /> : null}
            {connected && cap.accountDiscovery ? <ActionButton action={discoverAccounts} provider={c.provider} label={t('connections.ccDiscover')} busy={busy} /> : null}
            {connected && cap.sync ? <ActionButton action={retrySync} provider={c.provider} label={t('connections.ccRetrySync')} busy={busy} /> : null}
            {connected && cap.disconnect ? (
              <button className="button danger" type="button" disabled={busy} onClick={onDisconnect}>{busy ? t('connections.working') : t('connections.disconnect')}</button>
            ) : null}
          </>
        )}
      </div>

      {!cap.revokeProviderSide && connected ? <p className="inline-note">{t('connections.ccManualRevoke')}</p> : null}
      {notice?.error ? <div className="error-callout connection-feedback" role="alert">{notice.error}</div> : null}
      {notice?.success ? <div className="callout success connection-feedback" role="status">{notice.success}</div> : null}
    </article>
  );
}

function ActionButton({ action, provider, label, busy }: {
  action: (p: TenantActionResult | null, fd: FormData) => Promise<TenantActionResult>;
  provider: string; label: string; busy: boolean;
}) {
  const [state, run, pending] = useActionState<TenantActionResult | null, FormData>(action, null);
  return (
    <form action={run} className="connection-action-form">
      <input type="hidden" name="provider" value={provider} />
      <button className="button secondary" type="submit" disabled={pending || busy}>{pending ? '…' : label}</button>
      {state ? <span className={`inline-note ${state.ok ? '' : 'danger'}`} role="status">{state.message}</span> : null}
    </form>
  );
}
