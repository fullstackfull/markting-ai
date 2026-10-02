'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PlanLimitModal } from '@/components/plan-limit-modal';
import { useI18n } from '@/components/i18n-provider';
import { planLimitFromResponse, type PlanLimitDetails } from '@/lib/cloud/plan-limit';

interface Member { userId: string; email: string; displayName: string; role: string; }

export function TeamMembers({ organizationId, currentUserId, currentRole, members }: {
  organizationId: string;
  currentUserId: string;
  currentRole: string;
  members: Member[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [busy, setBusy] = useState(false);
  const [planLimit, setPlanLimit] = useState<PlanLimitDetails>();
  const canAdminister = currentRole === 'owner' || currentRole === 'admin';

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage({});
    const response = await fetch('/api/members', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId, ...body }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    const limit = planLimitFromResponse(result);
    if (limit) setPlanLimit(limit);
    else if (!response.ok) setMessage({ error: result.error ?? t('team.requestFailed') });
    else { setMessage({ success }); router.refresh(); }
    setBusy(false);
    return response.ok;
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (await call('POST', { email: data.email, role: data.role }, t('team.memberAdded'))) form.reset();
  }

  return (
    <>
      <PlanLimitModal limit={planLimit} onClose={() => setPlanLimit(undefined)} />
      {message.error ? <div className="card-body" style={{ paddingBottom: 0 }}><div className="error-callout" style={{ marginBottom: 0 }}>{message.error}</div></div> : null}
      {message.success ? <div className="card-body" style={{ paddingBottom: 0 }}><div className="callout success">{message.success}</div></div> : null}
      <div className="row-list">
        {members.map((member) => (
          <div className="row-item" key={member.userId}>
            <div>
              <strong>{member.displayName}{member.userId === currentUserId ? <span className="text-muted">{t('team.you')}</span> : null}</strong>
              <div className="cell-sub">{member.email}</div>
            </div>
            <div className="row-actions">
              {canAdminister && member.role !== 'owner'
                ? <select aria-label={t('team.roleFor', { email: member.email })} value={member.role} disabled={busy} onChange={(event) => void call('PATCH', { userId: member.userId, role: event.target.value }, t('team.roleUpdated'))}>
                    {currentRole === 'owner' ? <option value="admin">{t('team.roleAdmin')}</option> : null}
                    <option value="member">{t('team.roleMember')}</option>
                    <option value="viewer">{t('team.roleViewer')}</option>
                  </select>
                : <span className="status neutral">{t(`common.role_${member.role}`)}</span>}
              {canAdminister && member.userId !== currentUserId && member.role !== 'owner'
                ? <button className="button danger small" disabled={busy} onClick={() => { if (window.confirm(t('team.confirmRemove', { email: member.email }))) void call('DELETE', { userId: member.userId }, t('team.memberRemoved')); }}>{t('team.remove')}</button>
                : null}
            </div>
          </div>
        ))}
      </div>
      {canAdminister ? (
        <div className="card-body" style={{ borderTop: '1px solid var(--line-soft)' }}>
          <form className="form-row" onSubmit={(event) => void invite(event)}>
            <input name="email" type="email" required placeholder={t('team.emailPlaceholder')} style={{ flex: 1, minWidth: '14rem' }} aria-label={t('team.email')} />
            <select name="role" defaultValue="member" aria-label={t('team.role')}>
              {currentRole === 'owner' ? <option value="admin">{t('team.roleAdmin')}</option> : null}
              <option value="member">{t('team.roleMember')}</option>
              <option value="viewer">{t('team.roleViewer')}</option>
            </select>
            <button className="button secondary" disabled={busy}>{t('team.invite')}</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
