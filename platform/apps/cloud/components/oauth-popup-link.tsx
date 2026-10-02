'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { openProviderPopup } from '@/lib/oauth-popup';
import { useI18n } from '@/components/i18n-provider';

export function OAuthPopupLink({ href, label, className, children }: {
  href: string; label: string; className: string; children: ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => () => cleanup.current?.(), []);

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    cleanup.current?.();
    setTimedOut(false);
    cleanup.current = openProviderPopup(href, path => {
      setWaiting(false);
      router.push(path);
      router.refresh();
    }, () => { setWaiting(false); setTimedOut(true); });
    // Keep the ordinary anchor navigation if popups or messaging are blocked.
    if (!cleanup.current) return;
    event.preventDefault();
    setWaiting(true);
  }

  return <span className="oauth-popup-action">
    <a href={href} aria-label={label} className={className} onClick={open}>{children}</a>
    {waiting ? <span className="inline-note" role="status">{t('support.popupWaiting')} <a href={href} onClick={() => cleanup.current?.()}>{t('support.continueInTab')}</a></span> : null}
    {timedOut ? <span className="inline-note" role="status">{t('support.popupTimedOut')}</span> : null}
  </span>;
}
