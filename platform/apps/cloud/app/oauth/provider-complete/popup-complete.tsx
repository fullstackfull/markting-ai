'use client';

import { useEffect, useState } from 'react';
import { BrandLockup } from '@/components/logos';
import { popupChannelName } from '@/lib/oauth-popup';
import { useI18n } from '@/components/i18n-provider';

export function PopupComplete({ popupId, next }: { popupId?: string; next: string }) {
  const { t } = useI18n();
  const [received, setReceived] = useState(false);
  useEffect(() => {
    if (!popupId || typeof window.BroadcastChannel !== 'function') return;
    let channel: BroadcastChannel;
    try { channel = new window.BroadcastChannel(popupChannelName(popupId)); } catch { return; }
    channel.onmessage = event => {
      if (event.data?.type !== 'adport:oauth-received' || event.data?.popupId !== popupId) return;
      setReceived(true);
      window.close();
    };
    channel.postMessage({ type: 'adport:oauth-complete', popupId, next });
    return () => channel.close();
  }, [popupId, next]);
  const failed = new URL(next, 'https://adport.invalid').searchParams.has('error');
  return <main className="onboarding-page">
    <header className="onboarding-head"><BrandLockup /></header>
    <section className="card oauth-popup-complete">
      <h1>{failed ? t('misc.popupAttentionTitle') : t('misc.popupReturnTitle')}</h1>
      <p>{received ? t('misc.popupReadyCopy') : t('misc.popupReturningCopy')}</p>
      <a className="button" href={next}>{t('misc.continueInWindow')}</a>
    </section>
  </main>;
}
