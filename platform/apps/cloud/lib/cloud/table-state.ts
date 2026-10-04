/**
 * PHASE B (B5) — the one professional-analytics-table state model. Pure + deterministic (no React, no
 * DB) so it is unit-testable and shared by every table surface: sort, filter/search, bounded
 * pagination, and column visibility, all encoded in the URL search params (so a view is refreshable
 * and shareable). A `prefix` namespaces params so multiple independent tables can live on one page
 * (e.g. `c_sort` for campaigns and `g_sort` for ad groups) without colliding — and without touching
 * the Phase-A `range` param, which is always preserved.
 */
export interface TableState {
  sort?: string;
  dir: 'asc' | 'desc';
  q: string;
  page: number;
  /** Bounded page size — never an unbounded full-table render. */
  pageSize: number;
  /** Explicit visible-column keys, when the viewer overrode the default set. */
  cols?: string[];
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export interface ParseOptions {
  prefix?: string;
  defaultSort?: string;
  defaultDir?: 'asc' | 'desc';
  pageSize?: number;
  /** Sort keys the caller allows — a sort param outside this set is ignored (no injection). */
  allowedSorts?: readonly string[];
}

/** Parse a table's state from (already-awaited) searchParams. Clamps and whitelists every input. */
export function parseTableState(sp: SP, opts: ParseOptions = {}): TableState {
  const p = opts.prefix ? `${opts.prefix}_` : '';
  const rawSort = one(sp, `${p}sort`) ?? opts.defaultSort;
  const sort = rawSort && (!opts.allowedSorts || opts.allowedSorts.includes(rawSort)) ? rawSort : opts.defaultSort;
  const dir = one(sp, `${p}dir`) === 'asc' ? 'asc' : one(sp, `${p}dir`) === 'desc' ? 'desc' : (opts.defaultDir ?? 'desc');
  const q = (one(sp, `${p}q`) ?? '').toString().slice(0, 100);
  const pageRaw = Number.parseInt(one(sp, `${p}page`) ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 100_000) : 1;
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const colsRaw = one(sp, `${p}cols`);
  const cols = colsRaw ? colsRaw.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 50) : undefined;
  return { sort, dir, q, page, pageSize, cols };
}

export interface TableColumnSpec<T> {
  key: string;
  /** Sort comparator value; numeric columns sort numerically, others as locale strings. */
  sortValue?: (row: T) => number | string | null | undefined;
  numeric?: boolean;
  /** Free-text the search box matches against (case-insensitive substring). */
  searchText?: (row: T) => string;
}

export interface TablePage<T> {
  rows: T[];
  total: number;
  filtered: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/**
 * Apply a table state to a row set: filter (search) → sort → paginate. Pure. Sorting is stable and
 * null/undefined sort values always sink to the bottom regardless of direction (so missing data never
 * masquerades as "best" or "worst"). Returns the single page to render plus the counts for the pager.
 */
export function applyTableState<T>(rows: readonly T[], state: TableState, columns: readonly TableColumnSpec<T>[]): TablePage<T> {
  const total = rows.length;
  const byKey = new Map(columns.map((c) => [c.key, c]));

  let working = rows.slice();
  const q = state.q.trim().toLowerCase();
  if (q) {
    const searchable = columns.filter((c) => c.searchText);
    working = working.filter((row) => searchable.some((c) => c.searchText!(row).toLowerCase().includes(q)));
  }
  const filtered = working.length;

  const col = state.sort ? byKey.get(state.sort) : undefined;
  if (col?.sortValue) {
    const factor = state.dir === 'asc' ? 1 : -1;
    const keyed = working.map((row, i) => ({ row, i, v: col.sortValue!(row) }));
    keyed.sort((a, b) => {
      const an = a.v == null, bn = b.v == null;
      if (an && bn) return a.i - b.i;
      if (an) return 1; // nulls always last
      if (bn) return -1;
      let cmp: number;
      if (col.numeric) cmp = Number(a.v) - Number(b.v);
      else cmp = String(a.v).localeCompare(String(b.v));
      return cmp !== 0 ? cmp * factor : a.i - b.i; // stable tiebreak
    });
    working = keyed.map((k) => k.row);
  }

  const pageCount = Math.max(1, Math.ceil(filtered / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const start = (page - 1) * state.pageSize;
  return { rows: working.slice(start, start + state.pageSize), total, filtered, page, pageCount, pageSize: state.pageSize };
}
