'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/components/i18n-provider';

/**
 * Apply / reject controls for one pending operation. "Apply" performs adport's second call
 * (identical arguments plus the pending id) through the server, so the PolicyEngine re-verifies
 * hash, expiry and policy. "Reject" consumes the row and writes an audit event.
 */
export function ApprovalActions({ organizationId, pendingId, canApply }: { organizationId: string; pendingId: string; canApply: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState<'apply' | 'reject' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(action: 'apply' | 'reject') {
    if (action === 'apply' && !window.confirm(t('approvals.confirmApply'))) return;
    setBusy(action);
    setMessage(null);
    const response = await fetch(`/api/approvals/${encodeURIComponent(pendingId)}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMessage(result.error ?? t('approvals.couldNot', { action: t(`common.${action}`) }));
    else { setMessage(action === 'apply' ? t('common.applied') : t('common.rejected')); router.refresh(); }
    setBusy(null);
  }

  return (
    <div className="row-actions">
      {canApply ? <button type="button" className="button small" disabled={busy !== null} onClick={() => void act('apply')}>{busy === 'apply' ? t('common.applying') : t('common.apply')}</button> : null}
      <button type="button" className="button secondary small" disabled={busy !== null} onClick={() => void act('reject')}>{busy === 'reject' ? t('common.rejecting') : t('common.reject')}</button>
      {message ? <span className="cell-sub" role="status">{message}</span> : null}
    </div>
  );
}
