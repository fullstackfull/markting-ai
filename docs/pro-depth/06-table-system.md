# 06 — Professional table system

One primitive, reused everywhere — not per-page custom tables.

## Pieces
- `lib/cloud/table-state.ts` — pure, unit-tested state model: `parseTableState` (whitelists the sort
  key, clamps page/pageSize, namespaces params by `prefix`) and `applyTableState` (filter → sort →
  paginate; stable sort; null sort-values always sink last so missing data never looks best or worst).
  Bounded page size (default 25, max 100) — never an unbounded full-table render.
- `components/table-controls.tsx` — client controls (`SortHeader`, `TableSearch`, `TablePager`,
  `ColumnToggle`, `PresetTabs`). Each mutates only its own prefixed params and preserves everything
  else (the Phase-A `range`, sibling tables' state). No data lives client-side — the exact RangeControl
  URL-state pattern.
- `components/analytics-table.tsx` — the server-rendered table. Reuses the kit's table CSS
  (`.table-wrap`/`.numeric`/`.status`/`.cell-sub`) and the Phase-A money/number formatters.

## Mechanics (B5)
server-side/bounded pagination · sorting · filtering · search · column visibility · column presets ·
sticky identifiers (first column) · numeric alignment (tabular figures) · compact density · explicit
empty / search-empty / unavailable states · mixed-currency safety (per-row currency; never blended) ·
date-range propagation · RTL (logical properties) · accessibility (real `<th scope="col">` +
`aria-sort`, sr-only caption, keyboard-operable controls, `aria-live` counts).

## URL state (B5)
`page`, `sort`, `dir`, `q`, `cols` are all in the URL (prefixed), so a view is refreshable and
shareable and survives navigation. The `range` param is always preserved across table interactions.

## KPI presets (B6)
Performance / Efficiency / Delivery (and Commerce/Search/Social where the surface has that data). A
preset sets the visible-column set; it is not a 50-column default dump. Columns default to the
Performance set and the viewer can toggle individual columns.

## Reuse proof
`app/dashboard/reports/page.tsx` was migrated off its hand-built `<table>` onto `AnalyticsTable`,
gaining range + sort + search + pagination + presets + derived CPC/CPA/CTR with no new bespoke table
code. The drill-down surfaces (account campaigns, campaign ad-groups, ad-group ads) and the Breakdown
Explorer use the same primitive.
