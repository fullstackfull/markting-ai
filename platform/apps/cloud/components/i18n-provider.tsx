'use client';

import { createContext, useContext, useMemo } from 'react';
import { dirOf, type Locale } from '@/lib/i18n/config';
import { makeTranslators, type PluralTranslator, type Translator } from '@/lib/i18n';

interface I18nContextValue { locale: Locale; dir: 'rtl' | 'ltr'; t: Translator; tn: PluralTranslator }

const I18nContext = createContext<I18nContextValue | null>(null);

/** Provides the request locale to client components. Mounted once in the root layout. */
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<I18nContextValue>(() => ({ locale, dir: dirOf(locale), ...makeTranslators(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const fallback: I18nContextValue = { locale: 'en', dir: 'ltr', ...makeTranslators('en') };

/** Outside the provider (unit tests rendering a component in isolation) English is used. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? fallback;
}
