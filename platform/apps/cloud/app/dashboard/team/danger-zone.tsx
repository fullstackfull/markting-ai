'use client';

import { useState } from 'react';
import { useI18n } from '@/components/i18n-provider';

export function DangerZone({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function deleteOrganization() {
    if (confirmation !== 'DELETE') return;
    if (!window.confirm(t('team.confirmDelete'))) return;
    setBusy(true);
    setError(undefined);
    const response = await fetch('/api/deletion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organization_id: organizationId, confirmation }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? t('team.deleteFailed'));
      setBusy(false);
      return;
    }
    window.location.assign('/');
  }

  return (
    <section className="card danger">
      <div className="card-head"><h2>{t('team.deleteOrganization')}</h2><span className="status critical">{t('team.irreversible')}</span></div>
      <div className="card-body stack">
        <p className="subhead">{t('team.deleteCopy')}</p>
        {error ? <div className="error-callout" style={{ marginBottom: 0 }}>{error}</div> : null}
        <div className="form-row">
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={t('team.typeDelete')} aria-label={t('team.typeDelete')} style={{ maxWidth: '16rem' }} />
          <button className="button danger" disabled={busy || confirmation !== 'DELETE'} onClick={() => void deleteOrganization()}>{busy ? t('team.deleting') : t('team.deleteOrganization')}</button>
        </div>
      </div>
    </section>
  );
}
