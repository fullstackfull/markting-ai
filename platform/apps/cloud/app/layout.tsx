import type { Metadata } from 'next';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './globals.css';
import { I18nProvider } from '@/components/i18n-provider';
import { dirOf } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: { default: 'Adport', template: '%s · Adport' },
  description: 'Securely connect, report on, and manage advertising accounts from any AI agent.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
