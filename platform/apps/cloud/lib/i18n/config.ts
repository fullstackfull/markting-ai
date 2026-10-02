/** Locale configuration shared by server and client code. Arabic is the default and is RTL. */
export const LOCALES = ['ar', 'en'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'ar';
export const LOCALE_COOKIE = 'markting_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** BCP 47 tag for Intl formatters. Arabic keeps Latin digits so ad metrics read the same everywhere. */
export function intlTag(locale: Locale): string {
  return locale === 'ar' ? 'ar-u-nu-latn' : 'en';
}

/** Replace `{name}` placeholders. Missing values are left visible so they are easy to spot. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
