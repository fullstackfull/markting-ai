'use client';

import { DEFAULT_LOCALE, LOCALE_COOKIE, dirOf, isLocale, type Locale } from '@/lib/i18n/config';
import { makeTranslators } from '@/lib/i18n';

// The root layout (and its I18nProvider) is replaced by this boundary, so read the locale cookie directly.
function cookieLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const value = document.cookie.split('; ').find((part) => part.startsWith(`${LOCALE_COOKIE}=`))?.split('=')[1];
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = cookieLocale();
  const { t } = makeTranslators(locale);
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <main className="auth-page">
          <section className="auth-card">
            <div className="auth-bar">
              <div className="traffic" aria-hidden="true"><i /><i /><i /></div>
              <span>adport.dev — {t('misc.errorFrame')}</span>
            </div>
            <div className="auth-body">
              <h1>{t('misc.errorTitle')}</h1>
              <p>{t('misc.errorCopy')}</p>
              <button className="button full" onClick={reset}>{t('misc.tryAgain')}</button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
