import type { Locale } from '@/lib/i18n/config';
import { resolveRange, type RangeSelection } from '@/lib/cloud/date-range';

/**
 * PHASE A (A6) — freshness + window disclosure strip. States the selected window, the comparison window,
 * the timezone the boundaries were computed in (and explicitly flags a UTC fallback when the account/org
 * timezone is unknown), the data source/provenance, and the last refresh — so a user never mistakes a
 * stale or demo read for a live one.
 */
export function FreshnessBar({ selection, timezone, readAt, source, live, locale }: {
  selection: RangeSelection;
  timezone?: string | null;
  readAt?: string;
  source: string;
  live: boolean;
  locale: Locale;
}) {
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  let resolved;
  try { resolved = resolveRange(selection, timezone); } catch { resolved = resolveRange('last_30_days', timezone); }
  const { current, previous, timezone: tz, timezoneFallback } = resolved;
  return (
    <div className="freshness-bar cell-sub" role="status" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <span><strong>{L('Range', 'النطاق')}:</strong> {current.start} → {current.end}</span>
      <span><strong>{L('Compare', 'المقارنة')}:</strong> {previous.start} → {previous.end}</span>
      <span>
        <strong>{L('Timezone', 'المنطقة الزمنية')}:</strong> {tz}
        {timezoneFallback ? ` (${L('UTC fallback — account timezone not set', 'افتراضي UTC — المنطقة الزمنية للحساب غير محددة')})` : ''}
      </span>
      <span><strong>{L('Source', 'المصدر')}:</strong> {live ? 'LIVE' : 'DEMO / SYNTHETIC'} · {source}</span>
      <span><strong>{L('Last refresh', 'آخر تحديث')}:</strong> {readAt ? new Date(readAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : L('unknown', 'غير معروف')}</span>
    </div>
  );
}
