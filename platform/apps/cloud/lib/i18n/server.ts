import 'server-only';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, dirOf, isLocale, type Locale } from './config';
import { makeTranslators, type PluralTranslator, type Translator } from './index';

/** Locale for this request: cookie first, then Accept-Language, then Arabic (the product default). */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get('accept-language') ?? '';
  const preferred = accept.split(',').map((part) => part.trim().split(';')[0]?.toLowerCase().slice(0, 2)).find(isLocale);
  return preferred ?? DEFAULT_LOCALE;
}

export interface ServerI18n {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: Translator;
  tn: PluralTranslator;
}

/** Translators for server components and route handlers. */
export async function getT(): Promise<ServerI18n> {
  const locale = await getLocale();
  return { locale, dir: dirOf(locale), ...makeTranslators(locale) };
}
