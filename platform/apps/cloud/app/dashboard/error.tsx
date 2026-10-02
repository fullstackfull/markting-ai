'use client';

import { useI18n } from '@/components/i18n-provider';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{t('misc.dashboardErrorTitle')}</h1>
          <p className="subhead">{t('misc.dashboardErrorCopy')}</p>
        </div>
      </div>
      <div className="error-callout">{error.message}</div>
      <button className="button" onClick={reset}>{t('misc.tryAgain')}</button>
    </main>
  );
}
