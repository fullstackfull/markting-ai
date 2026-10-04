'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/components/i18n-provider';
import { RANGE_PRESETS, type RangePreset } from '@/lib/cloud/date-range';

/**
 * PHASE A (A6) — professional date-range control. Presets + a custom window, propagated via the `range`
 * search param so every surface resolves the SAME window (no per-surface window). Comparison period is
 * derived server-side (previous equal-length window).
 */
const PRESET_LABEL: Record<RangePreset, { en: string; ar: string }> = {
  today: { en: 'Today', ar: 'اليوم' },
  yesterday: { en: 'Yesterday', ar: 'أمس' },
  last_7_days: { en: 'Last 7 days', ar: 'آخر 7 أيام' },
  last_14_days: { en: 'Last 14 days', ar: 'آخر 14 يومًا' },
  last_30_days: { en: 'Last 30 days', ar: 'آخر 30 يومًا' },
};

export function RangeControl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { locale } = useI18n();
  const current = params.get('range') ?? 'last_30_days';
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  function go(range: string) {
    const next = new URLSearchParams(params.toString());
    next.set('range', range);
    router.push(`${pathname}?${next.toString()}`);
  }

  const lbl = (b: { en: string; ar: string }) => (locale === 'ar' ? b.ar : b.en);

  return (
    <div className="range-control" role="group" aria-label={locale === 'ar' ? 'نطاق التاريخ' : 'Date range'}>
      {RANGE_PRESETS.map((p) => (
        <button key={p} type="button" className={`range-chip${current === p ? ' active' : ''}`} aria-pressed={current === p} onClick={() => go(p)}>
          {lbl(PRESET_LABEL[p])}
        </button>
      ))}
      <span className="range-custom">
        <input type="date" aria-label={locale === 'ar' ? 'من' : 'From'} value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} />
        <span aria-hidden="true">–</span>
        <input type="date" aria-label={locale === 'ar' ? 'إلى' : 'To'} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        <button type="button" className="range-chip" disabled={!start || !end || start > end} onClick={() => go(`${start}..${end}`)}>
          {locale === 'ar' ? 'تطبيق' : 'Apply'}
        </button>
      </span>
    </div>
  );
}
