'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/components/i18n-provider';

/**
 * PHASE B (B5) — the client URL-state controls for AnalyticsTable: sortable headers, search, pagination
 * and column visibility. Each one mutates only its own prefixed params and PRESERVES everything else
 * (the Phase-A `range`, other tables' state) — the exact RangeControl pattern. No data lives here; the
 * server page re-reads the URL and renders the page. `prefix` namespaces multi-table pages.
 */
function useParamNav(prefix: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const p = prefix ? `${prefix}_` : '';
  const set = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(`${p}${k}`);
      else next.set(`${p}${k}`, v);
    }
    if (resetPage) next.delete(`${p}page`);
    router.push(`${pathname}?${next.toString()}`);
  };
  return { params, p, set };
}

const lbl = (locale: string, en: string, ar: string) => (locale === 'ar' ? ar : en);

/** A sortable column header: toggles asc/desc/off for this column, clearing others. */
export function SortHeader({ prefix, columnKey, label, align, active, dir }: { prefix: string; columnKey: string; label: string; align?: 'start' | 'end'; active: boolean; dir: 'asc' | 'desc' }) {
  const { set } = useParamNav(prefix);
  const { locale } = useI18n();
  const nextDir = active && dir === 'desc' ? 'asc' : 'desc';
  const arrow = active ? (dir === 'desc' ? '↓' : '↑') : '';
  return (
    <button
      type="button"
      className={`th-sort${active ? ' active' : ''}`}
      style={{ textAlign: align ?? 'start', width: '100%' }}
      aria-label={`${lbl(locale, 'Sort by', 'ترتيب حسب')} ${label}`}
      onClick={() => set({ sort: columnKey, dir: nextDir })}
    >
      {label} <span aria-hidden="true">{arrow}</span>
    </button>
  );
}

/** Debounce-free search box (submits on Enter / blur) that sets the prefixed `q` param. */
export function TableSearch({ prefix, initial, placeholder }: { prefix: string; initial: string; placeholder?: string }) {
  const { set } = useParamNav(prefix);
  const { locale } = useI18n();
  const [value, setValue] = useState(initial);
  const submit = () => set({ q: value.trim() || null });
  return (
    <input
      type="search"
      className="table-search"
      value={value}
      placeholder={placeholder ?? lbl(locale, 'Search…', 'بحث…')}
      aria-label={lbl(locale, 'Search table', 'بحث في الجدول')}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      onBlur={submit}
    />
  );
}

/** Pager: first/prev/next/last within the known page count. Buttons disable at the ends. */
export function TablePager({ prefix, page, pageCount }: { prefix: string; page: number; pageCount: number }) {
  const { set } = useParamNav(prefix);
  const { locale } = useI18n();
  if (pageCount <= 1) return null;
  const goto = (n: number) => set({ page: String(n) }, false);
  const atStart = page <= 1;
  const atEnd = page >= pageCount;
  return (
    <div className="table-pager" role="navigation" aria-label={lbl(locale, 'Pagination', 'ترقيم الصفحات')}>
      <button type="button" className="range-chip" disabled={atStart} aria-label={lbl(locale, 'First page', 'الصفحة الأولى')} onClick={() => goto(1)}>«</button>
      <button type="button" className="range-chip" disabled={atStart} onClick={() => goto(page - 1)}>{lbl(locale, 'Prev', 'السابق')}</button>
      <span className="cell-sub" aria-live="polite">{lbl(locale, 'Page', 'صفحة')} {page} / {pageCount}</span>
      <button type="button" className="range-chip" disabled={atEnd} onClick={() => goto(page + 1)}>{lbl(locale, 'Next', 'التالي')}</button>
      <button type="button" className="range-chip" disabled={atEnd} aria-label={lbl(locale, 'Last page', 'الصفحة الأخيرة')} onClick={() => goto(pageCount)}>»</button>
    </div>
  );
}

/** Column presets (Performance / Efficiency / Delivery / …). Each sets `cols` to its key list. */
export function PresetTabs({ prefix, presets, activeCols }: { prefix: string; presets: Array<{ id: string; label: string; keys: string[] }>; activeCols: string[] }) {
  const { set } = useParamNav(prefix);
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));
  return (
    <div className="preset-tabs" role="group">
      {presets.map((p) => (
        <button key={p.id} type="button" className={`range-chip${sameSet(p.keys, activeCols) ? ' active' : ''}`} aria-pressed={sameSet(p.keys, activeCols)} onClick={() => set({ cols: p.keys.join(',') }, false)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Column-visibility toggles. Writes the visible-key list into the prefixed `cols` param. */
export function ColumnToggle({ prefix, columns, visible }: { prefix: string; columns: Array<{ key: string; label: string }>; visible: string[] }) {
  const { set } = useParamNav(prefix);
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const toggle = (key: string) => {
    const nextVisible = visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key];
    if (!nextVisible.length) return; // never hide every column
    set({ cols: nextVisible.join(',') }, false);
  };
  return (
    <div className="col-toggle">
      <button type="button" className="range-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {lbl(locale, 'Columns', 'الأعمدة')}
      </button>
      {open && (
        <div className="col-toggle-menu" role="group" aria-label={lbl(locale, 'Toggle columns', 'إظهار/إخفاء الأعمدة')}>
          {columns.map((c) => (
            <label key={c.key} className="col-toggle-item">
              <input type="checkbox" checked={visible.includes(c.key)} onChange={() => toggle(c.key)} /> {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
