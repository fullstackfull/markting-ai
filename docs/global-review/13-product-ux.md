# 13 — Product UX Review (MARKTING-AI / Adport Cloud)

Independent reviewer, product-maturity council. Assessed as a working B2B operator tool from
code + e2e/a11y specs (no live browser). Every claim cites a file path. Brutally honest.

Scope reviewed: `platform/apps/cloud/app/*` (route groups, layouts, pages), `platform/apps/cloud/components/*`,
`platform/apps/cloud/app/globals.css`, `platform/apps/cloud/lib/i18n/*`, `platform/apps/cloud/e2e/a11y.spec.ts`.

---

## Summary verdict

This is a **genuinely well-engineered, accessible, Arabic-first intelligence/governance layer** with a
unusually disciplined design-system kit, excellent empty/loading/error handling, and best-in-class RTL.
It is held back as a *daily* operator tool by **navigation sprawl** (21 flat nav items with overlapping
names) and by **missing core operator table controls** — there is no search, no table sort, no
pagination, and no date-range picker anywhere in the operator dashboard. The intelligence surfaces
(diagnosis → contributing factors → recommendations) are strong and largely self-explaining; the
"spreadsheet operations" a media buyer does hourly are absent.

**Final verdict: WOULD_USE_AS_SECONDARY_TOOL** — strong as the intelligence + governance + reporting
layer alongside the native ad platforms, but not yet complete enough (filtering/sorting/search/date
range/mobile nav) to be the single daily driver.

---

## Scores (0–5)

| Dimension | Score |
|---|---|
| Information architecture & navigation | 3 |
| Density & visual hierarchy | 4 |
| Dashboards & data visualization | 4 |
| Filters / search / sort / drill-down | 2 |
| Empty / loading / error states | 5 |
| Responsive / mobile | 3 |
| Accessibility (a11y) | 4 |
| Arabic / RTL | 5 |
| Consistency | 4 |
| Cognitive load / learnability | 3 |

---

## Evidence by dimension

### Information architecture & navigation — 3/5

- The sidebar (`components/nav.tsx`) renders **15 primary + 6 utility = 21 flat links** with no grouping
  or sections beyond the primary/utility split. `PRIMARY_ITEMS` runs overview, workspace, assistant,
  recommendations, creative, commerce, experiments, agency, executive, connections, accounts, reports,
  findings, approvals, audit — a long, ungrouped list.
- **Overlapping / ambiguous concepts** force the user to learn the taxonomy: `workspace` ("Needs
  attention"), `findings`, `recommendations`, and `approvals` are four separate destinations with
  conceptually adjacent meanings; `overview` vs `executive` are two different "top-level" views; two
  nav items even reuse the same icon (`workspace` and `findings` both use `icon.findings`;
  `overview` and `executive` both use `icon.overview` — `nav.tsx`), weakening visual differentiation.
- Drill-down IA is good: `/dashboard/accounts/[accountId]/campaigns/[campaignId]` and
  `/dashboard/creative/[creativeId]` form a coherent entity hierarchy, and `components/intel.tsx`
  `EntityLink`/`SectionView` keep entity navigation consistent.
- Active state is correct and accessible (`aria-current="page"`, `nav.tsx` `NavLinks`).

### Density & visual hierarchy — 4/5

- A single, consistent primitive set in `components/kit.tsx` + `components/ui.tsx`: `PageHeader`,
  `MetricCard`/`Metric`, `DataTable`, `ChartCard`, `InsightCard`, `Timeline`, `FilterBar`, `StatusChip`.
- Metric grids (`globals.css` `.metrics` → `repeat(4, …)`) and card grids (`.grid-2`, `.grid-3`) give a
  clear scan hierarchy; tabular numerals + mono font on values (`.metric-value`, `.numeric`).
- High-density surfaces are structured rather than dumped: `workspace/page.tsx` sequences Diagnosis →
  Contributing factors (ranked) → Recommendations → Domain coverage; `accounts/[accountId]/page.tsx`
  composes 10 ordered sections (pacing, anomaly, forecast, creative, commerce, breakdown,
  cross-channel, memory, outcomes) as one narrative drill-down instead of scattered modules.
- Minor concern: heavy reliance on inline `style={{…}}` across pages (e.g. `workspace/page.tsx`,
  `intel.tsx`) rather than classes — works, but erodes the otherwise-clean design-system discipline.

### Dashboards & data visualization — 4/5

- `components/charts.tsx` is a strong, accessible inline-SVG chart kit (server components, no client
  JS): `TimeSeriesChart`, `BarChart`, `FunnelChart`, `PacingChart`. Each ships a `<title>`/`<desc>`,
  `role="img"` with `aria-label`, a **visible text summary**, native per-mark `<title>` hover tooltips,
  explicit empty and **insufficient-data** states (e.g. time series requires ≥3 points), and a
  **CVD-safe secondary encoding** (solid vs hatched pattern) for two-series comparisons.
- Trust/evidence framing is a genuine strength: `kit.tsx` `TrustBadge`, `ConfidenceBadge`, `RiskBadge`,
  `FreshnessBadge`, `EvidenceCard`, and the "Inspect evidence" `<details>` with raw JSON in
  `recommendations/page.tsx` make every claim auditable.
- Numeric axes are forced LTR with Latin numerals even in Arabic so metrics stay comparable
  (`charts.tsx` header comment; `lib/i18n/config.ts` `intlTag` → `ar-u-nu-latn`).
- Gap: chart text is fixed at `fontSize="11"` and labels are truncated (`b.label.slice(0, 22)`), which
  is small and can clip on dense breakdowns; no interactive crossfilter/zoom (acceptable for a
  read/governance tool).

### Filters / search / sort / drill-down — 2/5 (the weakest dimension)

- **No global search** anywhere in the operator dashboard. The only search in the repo is under
  `(admin)/admin/search`. `components/client-switcher.tsx` explicitly defers it:
  *"Free-text client search is a later enhancement."*
- **No table sorting and no pagination.** Grepping the dashboard tree for sort/paginate/offset/date-range
  returns nothing in the operator pages. `reports/page.tsx` renders a campaigns table with only a
  `truncated` flag — rows cannot be sorted by spend/ROAS or paged.
- **No date-range picker.** `reports/page.tsx` is hardcoded to `readReport(..., 'last_30_days')`;
  `reports/engine-reports.tsx` only offers fixed `weekly`/`monthly` runs. An operator cannot pick an
  arbitrary window from the UI.
- **Filtering is URL-param only.** `accounts/page.tsx` filters by provider solely via `?select_provider`
  / `?connected` search params; `account-access-manager.tsx` has no in-page search/filter/sort over the
  account list — a problem for agencies with many accounts.
- Credit where due: entity drill-down is good and consistent (account → campaign → creative via
  `EntityLink`, `SectionView` `creative`/`portfolio` rows linking to detail routes).

### Empty / loading / error states — 5/5

- Dedicated, reusable, i18n-aware states everywhere: `ui.tsx` `Empty` (title + copy + optional CTA),
  `kit.tsx` `BlockedState` (data exists but withheld — distinct from empty), chart `Empty` with a
  separate **insufficient-data** variant.
- 11 dashboard files use `Empty`/`EmptyState`/`BlockedState`; empties carry actionable CTAs (e.g.
  overview → `/dashboard/connections`).
- Loading: `dashboard/loading.tsx` is a true skeleton (header + 4 metric cards + rows) with
  `aria-busy="true"` and an `aria-label`.
- Errors: `dashboard/error.tsx` (reset button), `app/global-error.tsx` (reads locale cookie directly
  since the provider is unmounted, keeps RTL), `app/not-found.tsx`, plus inline `error-callout`/`callout
  success` with `role="alert"`/`role="status"` in `accounts/page.tsx`, `reports/page.tsx`.

### Responsive / mobile — 3/5

- Breakpoints exist and are sensible: `globals.css` `@media` at 1080/880/560/440/760px; grids collapse
  (`.grid-2`, `.grid-3` → `1fr`; `.metrics` → 2-col then 1); container queries on connection rows
  (`@container (max-width: 780px/420px)`); tables scroll via `.table-wrap { overflow-x: auto }`.
- **No mobile navigation pattern.** At `max-width: 880px` the sidebar simply becomes
  `flex-direction: column` at the top of the page (`globals.css` `.app-shell`/`.sidebar`). With 21 nav
  links that pushes a very long list above every page's content on phones — there is no
  hamburger/drawer/collapse (grep for hamburger/drawer/aria-expanded in components finds none).
- Reduced motion is respected (`@media (prefers-reduced-motion: reduce)`).

### Accessibility — 4/5

- There is a **real axe gate** (`e2e/a11y.spec.ts`): no `critical`/`serious` WCAG 2.1 A/AA violations,
  across 9 dashboard routes in English **and** an Arabic/RTL run, with **zero deliberately-excluded
  rules** and rich element-level failure output. This is a credible, honestly-configured gate.
- Status/identity is **never color-alone**: `kit.tsx` renders every status/badge as a word + dot
  (`StatusChip`), and charts use text summaries + hatch patterns — colorblind-safe by construction.
- Good primitives: `DataTable` has an `sr-only` `<caption>` and `scope="col"` headers; `.sr-only` util;
  `aria-current`, `aria-busy`, `role=status/alert`, `aria-label` used 77× across app/components;
  `:focus-visible` outlines on all interactive elements (`globals.css`); language switch sets
  `lang={next}` on the toggle (`locale-switcher.tsx`).
- Gaps: **no skip-to-content link** (keyboard users traverse all 21 nav items before reaching main);
  chart `fontSize="11"` is below comfortable minimums; the axe gate does not assert skip-link or tab
  order. Also the i18n fallback renders the raw key visibly on a missing string (`lib/i18n/index.ts`) —
  honest, but a missing translation would surface as a code-looking token to the user.

### Arabic / RTL — 5/5

- **Arabic is the default locale and RTL** (`lib/i18n/config.ts` `DEFAULT_LOCALE = 'ar'`, `dirOf`).
  `app/layout.tsx` sets `<html lang dir>` per request; `global-error.tsx` preserves it even when the
  provider is torn down.
- `globals.css` consistently uses **logical properties** — `border-inline-end`, `margin-inline-*`,
  `padding-inline-*`, `inset-inline-*`, `text-align: start/end` — rather than left/right, so the whole
  layout mirrors correctly (dozens of occurrences; left/right physical props are essentially absent).
- Thoughtful bidi detail: date ranges that must stay LTR are explicitly `dir="ltr"`
  (`reports/engine-reports.tsx`), and Arabic keeps **Latin digits** for ad metrics so numbers stay
  comparable across locales (`intlTag` → `ar-u-nu-latn`).
- Arabic ships as first-class content, not machine fill: bilingual `BiText` throughout the orchestrator
  surfaces (`intel.tsx`), plural rules via `Intl.PluralRules` with Arabic categories
  (`lib/i18n/index.ts` `translatePlural`), IBM Plex Sans Arabic font loaded. RTL is covered by its own
  axe test.

### Consistency — 4/5

- One design kit, one status tone scale (`kit.tsx` `TONE_CLASS`, comment: "ONE status vocabulary so
  red/yellow/green is never overloaded"); `PageHeader`/`EmptyState` re-exported so there is a single
  import path. Page structure (`<main className="page">` + `PageHeader` + cards) is uniform across 40
  dashboard files using the i18n catalog.
- **Consistency gap — two i18n patterns coexist.** 40 dashboard files use the `getT`/`useI18n` message
  catalog, but 5+ surfaces (`workspace/page.tsx`, `recommendations/page.tsx`,
  `accounts/[accountId]/page.tsx`, plus `intel.tsx`, `charts.tsx`, `kit.tsx`) hardcode bilingual UI
  labels inline via `const L = (locale, en, ar) => …`. Dynamic `BiText` from the orchestrator justifies
  some of this, but static chrome labels ("Diagnosis", "Pacing", "Recommendations") bypass the catalog
  — a maintainability/consistency risk, not a user-facing break.

### Cognitive load / learnability — 3/5

- The intelligence framing is genuinely self-explaining and reduces load: "Needs attention" with a
  single `nextAction` verdict, ranked contributing factors with confidence/trust/materiality, and
  explicit **"Review only — nothing is applied without explicit human approval"** messaging
  (`kit.tsx` `RecommendationCard`, `recommendations/page.tsx`) that makes the governance model legible
  without training. Demo/synthetic data is clearly flagged (`IntelMeta`, workspace).
- Working against it: the 21-item ungrouped nav with overlapping labels (workspace/findings/
  recommendations/approvals; overview/executive) means a new operator must build a mental model of
  *which surface answers which question* before they're productive — this needs onboarding/training.

---

## Top strengths

1. Best-in-class RTL/Arabic-first implementation (logical properties, Latin-digit metrics, RTL axe test).
2. Excellent empty/loading/error/blocked/insufficient-data coverage, all i18n- and RTL-aware.
3. Accessible-by-construction data viz and status system (text+color, CVD-safe, evidence-inspectable).
4. A real, honestly-configured axe gate (no critical/serious, EN + AR, zero suppressed rules).
5. Disciplined single design-system kit with one status vocabulary and consistent drill-down.

## Top gaps

1. No search, table sort, or pagination anywhere in the operator dashboard.
2. No date-range picker — reports fixed to `last_30_days` / weekly / monthly.
3. Navigation sprawl: 21 flat, partly-overlapping nav items; duplicate icons; two "top" views.
4. No mobile navigation pattern — 21 links stack above content, no hamburger/drawer; no skip-link.
5. Dual i18n patterns (catalog vs inline `L(locale,en,ar)`) create a consistency/maintenance seam.

## Verdict

**WOULD_USE_AS_SECONDARY_TOOL.** As an Arabic-first intelligence, governance, and reporting layer it is
polished, accessible, and trustworthy, and I would happily run it beside the native ad platforms. It is
not yet a daily single-pane driver because the everyday table mechanics an operator relies on
(search, filter, sort, pagination, arbitrary date ranges) and a usable mobile nav are missing.
