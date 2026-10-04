import type { Locale } from '@/lib/i18n/config';
import type { TableState, TablePage } from '@/lib/cloud/table-state';
import { SortHeader, TableSearch, TablePager, ColumnToggle, PresetTabs } from './table-controls';

/**
 * PHASE B (B5/B6) — the single professional analytics table. ONE server-rendered primitive every table
 * surface reuses (campaigns, ad groups, ads, breakdowns, reports), so there is no per-page custom table
 * behaviour. It reuses the kit's table CSS (.table-wrap/.numeric/.status), the Phase-A money/number
 * formatters, and the Phase-A URL-state pattern (sort/filter/search/pagination/columns all live in the
 * prefixed search params). Accessibility: real <th scope="col"> with aria-sort, an sr-only caption,
 * numeric alignment with tabular figures, keyboard-operable controls, RTL via logical properties.
 *
 * Data is prepared server-side (see applyTableState); this component only renders the current page.
 * States are explicit and distinct: NO_DATA vs NOT_AVAILABLE/NOT_SUPPORTED vs mixed-currency warning.
 */
export interface AnalyticsColumn<T> {
  key: string;
  header: { en: string; ar: string };
  align?: 'start' | 'end';
  numeric?: boolean;
  sortable?: boolean;
  /** Hidden by default unless a preset includes it. */
  defaultVisible?: boolean;
  render: (row: T, locale: Locale) => React.ReactNode;
}

export interface ColumnPreset {
  id: string;
  label: { en: string; ar: string };
  keys: string[];
}

export interface AnalyticsTableProps<T> {
  /** URL-param namespace (e.g. 'c' for campaigns, 'g' for ad groups) so several tables coexist. */
  prefix?: string;
  caption: { en: string; ar: string };
  columns: Array<AnalyticsColumn<T>>;
  page: TablePage<T>;
  state: TableState;
  rowKey: (row: T) => string;
  locale: Locale;
  searchable?: boolean;
  presets?: ColumnPreset[];
  /** Stable disclosure shown above the table (freshness / partial window / mixed currency etc.). */
  note?: React.ReactNode;
  /** Explicit unsupported/blocked state — the data is NOT available (vs merely empty). */
  unavailable?: { title: string; reason: string };
}

const L = (locale: Locale, b: { en: string; ar: string }) => (locale === 'ar' ? b.ar : b.en);

export function AnalyticsTable<T>(props: AnalyticsTableProps<T>) {
  const { prefix = '', columns, page, state, locale, rowKey } = props;

  if (props.unavailable) {
    return (
      <div className="blocked-state" role="note">
        <strong>{props.unavailable.title}</strong>
        <p className="cell-sub">{props.unavailable.reason}</p>
      </div>
    );
  }

  // Visible columns: explicit `cols` override → else all non-defaultVisible-false columns.
  const visibleKeys = state.cols && state.cols.length
    ? columns.filter((c) => state.cols!.includes(c.key)).map((c) => c.key)
    : columns.filter((c) => c.defaultVisible !== false).map((c) => c.key);
  const visible = columns.filter((c) => visibleKeys.includes(c.key));
  const activeCols = visible.map((c) => c.key);

  return (
    <div className="analytics-table">
      <div className="table-toolbar">
        {props.presets && props.presets.length ? (
          <PresetTabs prefix={prefix} presets={props.presets.map((p) => ({ id: p.id, label: L(locale, p.label), keys: p.keys }))} activeCols={activeCols} />
        ) : null}
        <div className="table-toolbar-end">
          {props.searchable ? <TableSearch prefix={prefix} initial={state.q} /> : null}
          <ColumnToggle prefix={prefix} columns={columns.map((c) => ({ key: c.key, label: L(locale, c.header) }))} visible={activeCols} />
        </div>
      </div>

      {props.note ? <div className="table-note cell-sub">{props.note}</div> : null}

      {page.filtered === 0 ? (
        <div className="table-empty cell-sub" role="status">
          {state.q ? L(locale, { en: 'No rows match your search.', ar: 'لا توجد صفوف مطابقة لبحثك.' }) : L(locale, { en: 'No data for this view.', ar: 'لا توجد بيانات لهذا العرض.' })}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{L(locale, props.caption)}</caption>
            <thead>
              <tr>
                {visible.map((c) => {
                  const active = state.sort === c.key;
                  const ariaSort = active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                  return (
                    <th key={c.key} scope="col" aria-sort={ariaSort} className={c.numeric ? 'numeric' : undefined}>
                      {c.sortable
                        ? <SortHeader prefix={prefix} columnKey={c.key} label={L(locale, c.header)} align={c.align ?? (c.numeric ? 'end' : 'start')} active={active} dir={state.dir} />
                        : L(locale, c.header)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={rowKey(row)}>
                  {visible.map((c) => (
                    <td key={c.key} className={c.numeric ? 'numeric' : undefined}>{c.render(row, locale)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="table-footer">
        <span className="cell-sub" aria-live="polite">
          {L(locale, { en: 'Showing', ar: 'عرض' })} {page.rows.length} / {page.filtered}
          {page.filtered !== page.total ? ` (${L(locale, { en: 'of', ar: 'من' })} ${page.total})` : ''}
        </span>
        <TablePager prefix={prefix} page={page.page} pageCount={page.pageCount} />
      </div>
    </div>
  );
}
