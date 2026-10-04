import type { ReportRow } from '@adport/core';
import { Empty, PageHeader, Provider, formatNumber, formatMoney } from '@/components/ui';
import { AnalyticsTable, type AnalyticsColumn, type ColumnPreset } from '@/components/analytics-table';
import { RangeControl } from '@/components/range-control';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { readReportRows } from '@/lib/cloud/reads';
import { parseRangeParam, resolveRange } from '@/lib/cloud/date-range';
import { parseTableState, applyTableState, type TableColumnSpec } from '@/lib/cloud/table-state';
import { loadBusinessContext } from '@/lib/markting/business-context';
import { EngineReports } from './engine-reports';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Reports' };

const ratio = (n?: number, d?: number) => (d && d > 0 ? (n ?? 0) / d : null);

// Allowed sort keys mirror the column keys — a sort param outside this set is ignored (no injection).
const SORTS = ['entity', 'spend', 'impressions', 'clicks', 'conversions', 'roas', 'cpc', 'cpa', 'ctr'] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireDashboardTenant();
  const sp = await searchParams;
  const selection = parseRangeParam(typeof sp.range === 'string' ? sp.range : undefined);
  const business = await loadBusinessContext(tenant.organizationId);
  const range = resolveRange(selection, business.timezone.value);
  const result = await readReportRows(
    { organizationId: tenant.organizationId, userId: tenant.userId, role: tenant.role, scopes: ['tools:read'] },
    { level: 'campaign', dateRange: range.current },
  );
  const rows = result.ok ? result.data.rows : [];
  const { t, locale } = await getT();
  const fmt = (value?: number) => formatNumber(value, locale);
  const money = (v: number | null | undefined, row: ReportRow) => (v == null ? '—' : row.currency ? formatMoney(v, row.currency, locale) : fmt(v));

  const columns: Array<AnalyticsColumn<ReportRow>> = [
    { key: 'entity', header: { en: 'Campaign', ar: 'الحملة' }, sortable: true, render: (r) => (<><strong>{r.entity.name || r.entity.id}</strong><div className="cell-sub">{r.accountId}</div></>) },
    { key: 'provider', header: { en: 'Provider', ar: 'المزود' }, render: (r) => <Provider name={r.provider} /> },
    { key: 'status', header: { en: 'Status', ar: 'الحالة' }, render: (r) => (r.entity.status ? <span className={`status ${/paused|disabled|removed/i.test(r.entity.status) ? 'neutral' : ''}`}>{r.entity.status}</span> : '—') },
    { key: 'spend', header: { en: 'Spend', ar: 'الإنفاق' }, numeric: true, sortable: true, render: (r) => money(r.metrics.spend, r) },
    { key: 'impressions', header: { en: 'Impressions', ar: 'الظهور' }, numeric: true, sortable: true, render: (r) => fmt(r.metrics.impressions) },
    { key: 'clicks', header: { en: 'Clicks', ar: 'النقرات' }, numeric: true, sortable: true, render: (r) => fmt(r.metrics.clicks) },
    { key: 'ctr', header: { en: 'CTR', ar: 'CTR' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => { const v = ratio(r.metrics.clicks, r.metrics.impressions); return v == null ? '—' : `${(v * 100).toFixed(2)}%`; } },
    { key: 'cpc', header: { en: 'CPC', ar: 'CPC' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => money(ratio(r.metrics.spend, r.metrics.clicks), r) },
    { key: 'conversions', header: { en: 'Conv.', ar: 'التحويلات' }, numeric: true, sortable: true, render: (r) => fmt(r.metrics.conversions) },
    { key: 'cpa', header: { en: 'CPA', ar: 'CPA' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => money(ratio(r.metrics.spend, r.metrics.conversions), r) },
    { key: 'roas', header: { en: 'ROAS', ar: 'ROAS' }, numeric: true, sortable: true, render: (r) => (r.metrics.roas == null ? '—' : `${fmt(r.metrics.roas)}×`) },
  ];
  const specs: Array<TableColumnSpec<ReportRow>> = [
    { key: 'entity', searchText: (r) => `${r.entity.name} ${r.entity.id} ${r.accountId} ${r.provider}`, sortValue: (r) => r.entity.name || r.entity.id },
    { key: 'spend', numeric: true, sortValue: (r) => r.metrics.spend ?? null },
    { key: 'impressions', numeric: true, sortValue: (r) => r.metrics.impressions ?? null },
    { key: 'clicks', numeric: true, sortValue: (r) => r.metrics.clicks ?? null },
    { key: 'conversions', numeric: true, sortValue: (r) => r.metrics.conversions ?? null },
    { key: 'roas', numeric: true, sortValue: (r) => r.metrics.roas ?? null },
    { key: 'cpc', numeric: true, sortValue: (r) => ratio(r.metrics.spend, r.metrics.clicks) },
    { key: 'cpa', numeric: true, sortValue: (r) => ratio(r.metrics.spend, r.metrics.conversions) },
    { key: 'ctr', numeric: true, sortValue: (r) => ratio(r.metrics.clicks, r.metrics.impressions) },
  ];
  const presets: ColumnPreset[] = [
    { id: 'performance', label: { en: 'Performance', ar: 'الأداء' }, keys: ['entity', 'provider', 'spend', 'impressions', 'clicks', 'conversions', 'roas'] },
    { id: 'efficiency', label: { en: 'Efficiency', ar: 'الكفاءة' }, keys: ['entity', 'provider', 'spend', 'cpc', 'cpa', 'ctr', 'roas'] },
    { id: 'delivery', label: { en: 'Delivery', ar: 'التسليم' }, keys: ['entity', 'provider', 'status', 'impressions', 'clicks', 'ctr'] },
  ];

  const state = parseTableState(sp, { defaultSort: 'spend', defaultDir: 'desc', allowedSorts: SORTS });
  const page = applyTableState(rows, state, specs);

  return (
    <main className="page">
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <RangeControl />
      {!result.ok ? <div className="error-callout">{t('reports.readFailed', { error: (result as { error: string }).error })}</div> : null}
      {result.warnings.map((warning) => <div className="error-callout" key={`${warning.provider}:${warning.message}`}>{t('reports.partialRead', { message: warning.message })}</div>)}
      <EngineReports organizationId={tenant.organizationId} canRun={tenant.role !== 'viewer'} />
      <section className="card">
        {rows.length === 0 ? (
          <Empty
            title={t('reports.emptyTitle')}
            copy={result.connected ? t('reports.emptyConnected') : t('reports.emptyNotConnected')}
            href="/dashboard/connections"
            action={t('reports.manageConnections')}
          />
        ) : (
          <>
            <div className="card-head"><h2>{t('reports.campaigns')}</h2><span className="card-note">{t('reports.note', { rows: rows.length })}{result.ok && result.data.truncated ? t('reports.truncated') : ''}</span></div>
            <AnalyticsTable
              prefix="r"
              caption={{ en: 'Campaign performance report', ar: 'تقرير أداء الحملات' }}
              columns={columns}
              page={page}
              state={state}
              rowKey={(r) => `${r.provider}:${r.accountId}:${r.entity.id}`}
              locale={locale}
              searchable
              presets={presets}
            />
          </>
        )}
      </section>
    </main>
  );
}
