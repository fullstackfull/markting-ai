import { describe, expect, it } from 'vitest';
import { messages } from '@/lib/i18n/messages';
import { interpolate, isLocale, dirOf, intlTag } from '@/lib/i18n/config';
import { translate, translatePlural } from '@/lib/i18n';

const AD_TERMS = ['ROAS', 'CPA', 'CTR', 'CPC', 'CPM'];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

describe('i18n catalogue', () => {
  it('has the same areas in both locales', () => {
    expect(Object.keys(messages.ar).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('every English key has a non-empty Arabic translation (plural categories may differ)', () => {
    const missing: string[] = [];
    for (const [area, en] of Object.entries(messages.en)) {
      const ar = messages.ar[area as keyof typeof messages.ar] as Record<string, string>;
      for (const [key, value] of Object.entries(en as Record<string, string>)) {
        const base = key.replace(PLURAL_SUFFIX, '');
        const isPlural = PLURAL_SUFFIX.test(key);
        const arHas = isPlural ? Object.keys(ar).some((k) => k.replace(PLURAL_SUFFIX, '') === base && ar[k]!.trim()) : typeof ar[key] === 'string' && ar[key]!.trim().length > 0;
        if (!arHas) missing.push(`${area}.${key}`);
        if (typeof value !== 'string' || !value.trim()) missing.push(`${area}.${key} (empty en)`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('Arabic keys never exceed English keys except plural categories', () => {
    const extra: string[] = [];
    for (const [area, ar] of Object.entries(messages.ar)) {
      const en = messages.en[area as keyof typeof messages.en] as Record<string, string>;
      for (const key of Object.keys(ar as Record<string, string>)) {
        if (key in en) continue;
        const base = key.replace(PLURAL_SUFFIX, '');
        if (PLURAL_SUFFIX.test(key) && Object.keys(en).some((k) => k.replace(PLURAL_SUFFIX, '') === base)) continue;
        extra.push(`${area}.${key}`);
      }
    }
    expect(extra).toEqual([]);
  });

  it('keeps every placeholder present in both languages', () => {
    const mismatched: string[] = [];
    for (const [area, en] of Object.entries(messages.en)) {
      const ar = messages.ar[area as keyof typeof messages.ar] as Record<string, string>;
      for (const [key, value] of Object.entries(en as Record<string, string>)) {
        if (PLURAL_SUFFIX.test(key) || !ar[key]) continue;
        const enVars = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const arVars = [...ar[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        if (JSON.stringify(enVars) !== JSON.stringify(arVars)) mismatched.push(`${area}.${key}: en ${enVars} vs ar ${arVars}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('keeps ad terms in English inside Arabic strings', () => {
    const arabicTerms = ['عائد الإنفاق الإعلاني', 'تكلفة الاكتساب', 'نسبة النقر'];
    for (const [area, ar] of Object.entries(messages.ar)) {
      for (const [key, value] of Object.entries(ar as Record<string, string>)) {
        for (const term of arabicTerms) expect(value, `${area}.${key} translates an ad term`).not.toContain(term);
      }
    }
    // Every English string that mentions an ad term keeps that term verbatim in Arabic.
    for (const [area, en] of Object.entries(messages.en)) {
      const ar = messages.ar[area as keyof typeof messages.ar] as Record<string, string>;
      for (const [key, value] of Object.entries(en as Record<string, string>)) {
        for (const term of AD_TERMS) if (value.includes(term) && ar[key]) expect(ar[key], `${area}.${key} must keep ${term}`).toContain(term);
      }
    }
  });

  it('translates, interpolates and falls back visibly', () => {
    expect(translate('ar', 'nav.overview')).toBe('نظرة عامة');
    expect(translate('en', 'nav.overview')).toBe('Overview');
    expect(translate('ar', 'reports.note', { rows: 7 })).toContain('7');
    expect(translate('ar', 'nav.does_not_exist')).toBe('nav.does_not_exist');
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('selects Arabic plural categories', () => {
    expect(translatePlural('ar', 'overview.operations', 0)).toBe('لا عمليات');
    expect(translatePlural('ar', 'overview.operations', 1)).toBe('عملية واحدة');
    expect(translatePlural('ar', 'overview.operations', 2)).toBe('عمليتان');
    expect(translatePlural('ar', 'overview.operations', 5)).toBe('5 عمليات');
    expect(translatePlural('ar', 'overview.operations', 15)).toBe('15 عملية');
    expect(translatePlural('en', 'overview.operations', 1)).toBe('1 operation');
    expect(translatePlural('en', 'overview.operations', 3)).toBe('3 operations');
  });

  it('locale helpers', () => {
    expect(isLocale('ar') && isLocale('en') && !isLocale('fr')).toBe(true);
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
    expect(new Intl.NumberFormat(intlTag('ar')).format(1234.5)).toMatch(/1/); // Latin digits kept
  });
});
