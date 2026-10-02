'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/components/i18n-provider';

export const SUPPORT_OPEN_EVENT = 'adport:support-open';

export function SupportWidget() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SUPPORT_OPEN_EVENT, show);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    firstInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage({});
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, pagePath: window.location.pathname }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; notificationDelayed?: boolean };
      if (!response.ok) setMessage({ error: result.error ?? t('support.sendFailed') });
      else {
        form.reset();
        setMessage({ success: result.notificationDelayed ? t('support.savedDelayed') : t('support.thanks') });
      }
    } catch {
      setMessage({ error: t('support.sendFailedNetwork') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="support-fab" type="button" onClick={() => setOpen(true)} aria-label={t('support.fabLabel')}>
        <Image src="/yannick-support.png" alt={t('support.avatarAlt')} width={48} height={48} />
        <span>{t('support.needHelp')}</span>
      </button>
      {open ? (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-title">
            <button className="modal-close" type="button" onClick={() => setOpen(false)} aria-label={t('support.closeDialog')}>×</button>
            <div className="support-person">
              <Image src="/yannick-support.png" alt="" width={58} height={58} />
              <div><span className="plan-kicker">{t('support.directSupport')}</span><h2 id="support-title">{t('support.talkTo')}</h2><p>{t('support.intro')}</p></div>
            </div>
            {message.error ? <div className="error-callout" role="alert">{message.error}</div> : null}
            {message.success ? <div className="callout success" role="status">{message.success}</div> : null}
            <form className="form" onSubmit={(event) => void submit(event)}>
              <label className="field"><span>{t('support.messageType')}</span><select name="kind" defaultValue="support"><option value="support">{t('support.kind_support')}</option><option value="feedback">{t('support.kind_feedback')}</option><option value="bug">{t('support.kind_bug')}</option></select></label>
              <label className="field"><span>{t('support.subject')}</span><input ref={firstInput} name="subject" minLength={3} maxLength={160} required placeholder={t('support.subjectPlaceholder')} /></label>
              <label className="field"><span>{t('support.message')}</span><textarea name="message" minLength={10} maxLength={5000} required placeholder={t('support.messagePlaceholder')} /></label>
              <input className="support-honeypot" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
              <div className="modal-actions"><button className="button" disabled={busy}>{busy ? t('support.sending') : t('support.sendMessage')}</button><button className="button secondary" type="button" onClick={() => setOpen(false)}>{t('support.cancel')}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
