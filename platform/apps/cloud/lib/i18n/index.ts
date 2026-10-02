/**
 * Translation lookup shared by server and client code (no React, no server-only imports).
 *
 * Messages live in `./messages/<area>.ts`, each exporting `{ en: {...}, ar: {...} }` with flat keys.
 * Keys are addressed as `area.key`, e.g. `t('nav.overview')`. Ad terms (ROAS, CPA, CTR, CPC, CPM)
 * stay in English in both languages.
 */
import { DEFAULT_LOCALE, interpolate, type Locale } from './config';
import { messages, type Messages } from './messages';

export type { Locale } from './config';
export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, dirOf, intlTag, isLocale } from './config';
export type { Messages };

export type Vars = Record<string, string | number>;

export function getMessages(locale: Locale): Messages {
  return messages[locale] ?? messages[DEFAULT_LOCALE];
}

/** Resolve `area.key` in `locale`, falling back to English, then to the key itself (visible, never silent). */
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const [area, name] = key.split('.', 2) as [keyof Messages, string];
  const bundle = (messages[locale] ?? messages[DEFAULT_LOCALE])[area] as Record<string, string> | undefined;
  const fallback = messages.en[area] as Record<string, string> | undefined;
  const template = bundle?.[name] ?? fallback?.[name];
  if (template === undefined) {
    if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] missing message: ${key}`);
    return key;
  }
  return interpolate(template, vars);
}

/**
 * Plural lookup: `area.key_one` / `area.key_other` (and `_zero`, `_two`, `_few`, `_many` for Arabic)
 * chosen with Intl.PluralRules; `{count}` is interpolated.
 */
export function translatePlural(locale: Locale, key: string, count: number, vars?: Vars): string {
  const category = new Intl.PluralRules(locale).select(count);
  const [area, name] = key.split('.', 2) as [keyof Messages, string];
  const bundle = (messages[locale] ?? messages[DEFAULT_LOCALE])[area] as Record<string, string> | undefined;
  const chosen = bundle?.[`${name}_${category}`] !== undefined ? `${key}_${category}` : `${key}_other`;
  return translate(locale, chosen, { count, ...vars });
}

export type Translator = (key: string, vars?: Vars) => string;
export type PluralTranslator = (key: string, count: number, vars?: Vars) => string;

export function makeTranslators(locale: Locale): { t: Translator; tn: PluralTranslator } {
  return {
    t: (key, vars) => translate(locale, key, vars),
    tn: (key, count, vars) => translatePlural(locale, key, count, vars),
  };
}
