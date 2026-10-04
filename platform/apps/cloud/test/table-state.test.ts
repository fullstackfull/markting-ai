import { describe, expect, it } from 'vitest';
import { parseTableState, applyTableState, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type TableColumnSpec } from '@/lib/cloud/table-state';

/** PHASE B (B5) — the professional-table state model: parse (whitelisted/clamped), filter, sort, paginate. */
interface Row { name: string; spend: number | null; roas?: number }
const specs: Array<TableColumnSpec<Row>> = [
  { key: 'name', sortValue: (r) => r.name, searchText: (r) => r.name },
  { key: 'spend', numeric: true, sortValue: (r) => r.spend },
  { key: 'roas', numeric: true, sortValue: (r) => r.roas ?? null },
];
const rows: Row[] = [
  { name: 'Brand Search', spend: 300, roas: 4 },
  { name: 'Prospecting', spend: 1000, roas: 2 },
  { name: 'Retargeting', spend: null, roas: 6 },
  { name: 'Discovery', spend: 500 },
];

describe('parseTableState', () => {
  it('defaults and clamps', () => {
    const s = parseTableState({}, { defaultSort: 'spend', pageSize: 2 });
    expect(s).toMatchObject({ sort: 'spend', dir: 'desc', q: '', page: 1, pageSize: 2 });
  });
  it('namespaces by prefix and preserves independence', () => {
    const sp = { c_sort: 'spend', c_dir: 'asc', g_sort: 'roas', g_page: '3' };
    expect(parseTableState(sp, { prefix: 'c', allowedSorts: ['spend'] })).toMatchObject({ sort: 'spend', dir: 'asc' });
    expect(parseTableState(sp, { prefix: 'g', allowedSorts: ['roas'] })).toMatchObject({ sort: 'roas', page: 3 });
  });
  it('whitelists the sort key (ignores an unknown/injected sort)', () => {
    expect(parseTableState({ sort: 'drop table' }, { defaultSort: 'name', allowedSorts: ['name', 'spend'] }).sort).toBe('name');
  });
  it('clamps page size to the max and coerces bad page numbers', () => {
    expect(parseTableState({}, { pageSize: 9999 }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parseTableState({ page: '-4' }).page).toBe(1);
    expect(parseTableState({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('applyTableState', () => {
  it('sorts numerically with nulls always last, regardless of direction', () => {
    const desc = applyTableState(rows, parseTableState({ sort: 'spend', dir: 'desc' }, { allowedSorts: ['spend'] }), specs);
    expect(desc.rows.map((r) => r.name)).toEqual(['Prospecting', 'Discovery', 'Brand Search', 'Retargeting']);
    const asc = applyTableState(rows, parseTableState({ sort: 'spend', dir: 'asc' }, { allowedSorts: ['spend'] }), specs);
    expect(asc.rows.map((r) => r.name)).toEqual(['Brand Search', 'Discovery', 'Prospecting', 'Retargeting']); // null still last
  });
  it('filters by search across searchable columns', () => {
    const p = applyTableState(rows, parseTableState({ q: 'search' }, {}), specs);
    expect(p.filtered).toBe(1);
    expect(p.rows[0]!.name).toBe('Brand Search');
  });
  it('paginates with bounded page size and reports counts', () => {
    const p = applyTableState(rows, parseTableState({ page: '2' }, { pageSize: 2 }), specs);
    expect(p.pageSize).toBe(2);
    expect(p.pageCount).toBe(2);
    expect(p.rows.length).toBe(2);
    expect(p.total).toBe(4);
  });
  it('clamps an out-of-range page to the last page', () => {
    const p = applyTableState(rows, parseTableState({ page: '99' }, { pageSize: 2 }), specs);
    expect(p.page).toBe(2);
  });
});
