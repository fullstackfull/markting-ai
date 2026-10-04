'use client';

import { useState } from 'react';
import { OAuthPopupLink } from '@/components/oauth-popup-link';
import { useI18n } from '@/components/i18n-provider';
import type { CanonicalConnection } from '@/lib/connections/types';

/**
 * Consistent integration wizard: select → explain → permissions → authenticate → discover/select →
 * validate → finish. It NEVER shows a success state before validation: authentication opens the hosted
 * OAuth popup, and the connection only becomes "connected" once the server verifies the grant and the
 * tenant finishes account selection. The wizard front-loads what will be connected and which permissions
 * are requested, grounded in the provider registry (no unsupported step is shown).
 */
const STEPS = ['intro', 'permissions', 'authenticate', 'validate'] as const;

export function ConnectionWizard({ connection, organizationId, onClose }: {
  connection: CanonicalConnection; organizationId: string; onClose: () => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const startHref = `/api/oauth/${connection.provider}/start?organization_id=${organizationId}`;
  const current = STEPS[step]!;

  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label={t('connections.ccWizardTitle', { provider: connection.label })}>
      <div className="wizard-panel">
        <header className="wizard-head">
          <h2>{t('connections.ccWizardTitle', { provider: connection.label })}</h2>
          <button type="button" className="button ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="inline-note">{t('connections.ccWizardStep', { n: String(step + 1), total: String(STEPS.length) })}</p>

        {current === 'intro' ? (
          <div className="stack">
            <p>{t('connections.ccWizardIntro', { provider: connection.label })}</p>
            <p className="inline-note">Auth: {connection.authType ?? '—'} · Environment: {connection.environment}</p>
          </div>
        ) : null}

        {current === 'permissions' ? (
          <div className="stack">
            <h3>{t('connections.ccWizardPermissions')}</h3>
            {connection.scopesRequired.length ? (
              <ul className="scope-list">{connection.scopesRequired.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
            ) : <p className="inline-note">This provider does not expose a discrete scope list; access is governed by the account grant.</p>}
          </div>
        ) : null}

        {current === 'authenticate' ? (
          <div className="stack">
            <p>{t('connections.ccWizardNoSuccessYet')}</p>
            <OAuthPopupLink className="button" label={t('connections.connectProvider', { provider: connection.label })} href={startHref}>
              {t('connections.ccWizardAuthenticate')}
            </OAuthPopupLink>
          </div>
        ) : null}

        {current === 'validate' ? (
          <div className="stack">
            <p>{t('connections.ccWizardValidate')}: after authenticating, MARKTING-AI verifies the grant and lists the accounts it can reach. Choose which accounts to activate — nothing is activated automatically.</p>
            <p className="inline-note">{t('connections.ccWizardNoSuccessYet')}</p>
          </div>
        ) : null}

        <footer className="wizard-foot">
          <button type="button" className="button secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>{t('connections.ccWizardBack')}</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>{t('connections.ccWizardNext')}</button>
          ) : (
            <button type="button" className="button" onClick={onClose}>{t('connections.ccWizardFinish')}</button>
          )}
        </footer>
      </div>
    </div>
  );
}
