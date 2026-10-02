'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from './i18n-provider';
import type { Locale } from '@/lib/i18n/config';

/** Arabic / English toggle. Stores the choice in a cookie and re-renders the server tree. */
export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next: Locale = locale === 'ar' ? 'en' : 'ar';

  async function change() {
    setBusy(true);
    try {
      await fetch('/api/locale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: next }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={compact ? 'link-button locale-switcher' : 'button secondary small locale-switcher'} onClick={() => void change()} disabled={busy} lang={next} aria-label={t('common.switchLanguage')}>
      {next === 'ar' ? 'العربية' : 'English'}
    </button>
  );
}
