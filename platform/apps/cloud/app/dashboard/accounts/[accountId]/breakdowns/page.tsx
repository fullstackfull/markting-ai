import Link from 'next/link';
import { PageHeader, formatMoneyMinor } from '@/components/ui';
import { IntelMeta } from '@/components/intel';
import { BlockedState } from '@/components/kit';
import { AnalyticsTable, type AnalyticsColumn } from '@/components/analytics-table';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { authorizeTenantAccount } from '@/lib/cloud/account-authz';
import { loadBreakdownExplorer } from '@/lib/cloud/intelligence';
import type { ExplorerValueRow } from '@/lib/cloud/breakdown-explorer';
import { getT } from '@/lib/i18n/server';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { RangeControl } from '@/components/range-control';
import { FreshnessBar } from '@/components/freshness-bar';
import { parseRangeParam } from '@/lib/cloud/date-range';
import { parseTableState, applyTableState, type TableColumnSpec } from '@/lib/cloud/table-state';
import { loadBusinessContext } from '@/lib/markting/business-context';
import { DimensionControl, type DimensionChoice } from './dimension-control';

export const metadata = { title: 'Breakdown Explorer' };

// Allowed sort keys mirror the column keys — a sort param outside this set is ignored (no injection).
const BREAKDOWN_SORTS = ['value', 'spend', 'conversions', 'cpa', 'roas', 'share'] as const;

/**
 * PHASE B (B11) — the Breakdown Explorer. A media buyer picks a supported breakdown dimension and sees
 * per-value spend / conversions / CPA / ROAS / spend-share rows plus the deterministic concentration +
 * efficiency findings. STRICTLY capability-gated by the connection registry: an unsupported dimension is
 * never shown as data. In DEMO the rows are the CLEARLY-SYNTHETIC seed fed through the real engine;
 * live is honestly NOT_CONNECTED (no provider feeds breakdowns into the normalized report path).
 */
export default async function BreakdownsPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId } = await params;
  const tenant = await requireDashboardTenant();
  await authorizeTenantAccount(tenant, accountId);
  const { t, locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const sp = await searchParams;
  const rangeRaw = typeof sp.range === 'string' ? sp.range : undefined;
  const selection = parseRangeParam(rangeRaw);
  const dimParam = typeof sp.dim === 'string' ? sp.dim : undefined;

  const [view, business] = await Promise.all([
    loadBreakdownExplorer(tenant, accountId, dimParam),
    loadBusinessContext(tenant.organizationId),
  ]);
  const demo = resolveRuntimeMode() === 'DEMO';

  const dimLabel = (d: string) => t(`breakdowns.dim_${d}`);
  const choices: DimensionChoice[] = view.dimensions.map((d) => ({ dimension: d.dimension, label: dimLabel(d.dimension), reachable: d.reachable, rawOnly: d.rawOnly }));
  const hasReachable = view.reachable.length > 0;

  const money = (v: number | null, row: ExplorerValueRow) => (v == null ? '—' : formatMoneyMinor(v, row.currency, locale));
  const columns: Array<AnalyticsColumn<ExplorerValueRow>> = [
    { key: 'value', header: { en: t('breakdowns.colValue'), ar: t('breakdowns.colValue') }, sortable: true, render: (r) => r.value },
    { key: 'spend', header: { en: t('breakdowns.colSpend'), ar: t('breakdowns.colSpend') }, numeric: true, sortable: true, render: (r) => money(r.spendMinor, r) },
    { key: 'conversions', header: { en: t('breakdowns.colConversions'), ar: t('breakdowns.colConversions') }, numeric: true, sortable: true, render: (r) => String(r.conversions) },
    { key: 'cpa', header: { en: t('breakdowns.colCpa'), ar: t('breakdowns.colCpa') }, numeric: true, sortable: true, render: (r) => money(r.cpaMinor, r) },
    { key: 'roas', header: { en: t('breakdowns.colRoas'), ar: t('breakdowns.colRoas') }, numeric: true, sortable: true, render: (r) => (r.roas == null ? '—' : `${r.roas}×`) },
    { key: 'share', header: { en: t('breakdowns.colShare'), ar: t('breakdowns.colShare') }, numeric: true, sortable: true, render: (r) => `${r.spendSharePct}%` },
  ];
  const specs: Array<TableColumnSpec<ExplorerValueRow>> = [
    { key: 'value', searchText: (r) => r.value, sortValue: (r) => r.value },
    { key: 'spend', numeric: true, sortValue: (r) => r.spendMinor },
    { key: 'conversions', numeric: true, sortValue: (r) => r.conversions },
    { key: 'cpa', numeric: true, sortValue: (r) => r.cpaMinor },
    { key: 'roas', numeric: true, sortValue: (r) => r.roas },
    { key: 'share', numeric: true, sortValue: (r) => r.spendSharePct },
  ];
  const state = parseTableState(sp, { prefix: 'b', defaultSort: 'spend', defaultDir: 'desc', allowedSorts: BREAKDOWN_SORTS });
  const page = applyTableState(view.rows, state, specs);

  // B22 — explicitly distinct states: an unsupported dimension (or live, not in the normalized path) is
  // the AnalyticsTable `unavailable` state; NO_DATA and NOT_CONNECTED are their own honest notes.
  const unavailable = view.state === 'NOT_SUPPORTED'
    ? { title: t('breakdowns.notSupportedTitle'), reason: t('breakdowns.notSupportedCopy') }
    : undefined;

  const analysis = view.analysis;
  const isProtected = !!view.selectedMeta?.protectedDimension;
  const selectedLabel = view.selected ? dimLabel(view.selected) : '';

  return (
    <main className="page">
      <PageHeader title={t('breakdowns.title')} description={accountId} />
      <p className="cell-sub" style={{ marginTop: -6, marginBottom: 8 }}>
        <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}?range=${encodeURIComponent(rangeRaw ?? 'last_30_days')}`} prefetch={false}>{L('Account', 'الحساب')}</Link>
        {' ▸ '}<span>{t('breakdowns.title')}</span>
      </p>
      <p style={{ marginTop: 0, marginBottom: 10 }}>{t('breakdowns.description')}</p>
      <RangeControl />
      <FreshnessBar selection={selection} timezone={business.timezone.value} source="DETERMINISTIC_ONLY" live={!demo} locale={locale} />
      <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />

      {!demo ? (
        <BlockedState title={t('breakdowns.notConnectedTitle')} reason={t('breakdowns.notConnectedCopy')} />
      ) : !hasReachable ? (
        <BlockedState title={t('breakdowns.noReachableTitle')} reason={t('breakdowns.noReachableCopy')} />
      ) : (
        <>
          <section className="card" style={{ marginBottom: 12 }}>
            <div className="card-head"><h2>{t('breakdowns.dimension')}</h2><span className="card-note">{dimLabel(view.selected ?? '')}</span></div>
            <DimensionControl choices={choices} selected={view.selected} />
            {view.dimensions.some((d) => !d.reachable) && (
              <p className="cell-sub" style={{ marginTop: 8 }}>
                {t('breakdowns.unavailableHeading')}: {view.dimensions.filter((d) => !d.reachable).map((d) => dimLabel(d.dimension)).join('، ')}
              </p>
            )}
          </section>

          {isProtected && view.state === 'OK' && (
            <div className="blocked-state" role="note" style={{ marginBottom: 12 }}>
              <strong>{t('breakdowns.protectedTitle')}: {selectedLabel}</strong>
              <p className="cell-sub">{t('breakdowns.protectedNote')}</p>
            </div>
          )}

          {view.state === 'NO_DATA' ? (
            <BlockedState title={t('breakdowns.noDataTitle')} reason={t('breakdowns.noDataCopy')} />
          ) : (
            <section className="card" style={{ marginBottom: 12 }}>
              <div className="card-head"><h2>{selectedLabel}</h2></div>
              <AnalyticsTable
                prefix="b"
                caption={{ en: t('breakdowns.tableCaption'), ar: t('breakdowns.tableCaption') }}
                columns={columns}
                page={page}
                state={state}
                rowKey={(r) => r.value}
                locale={locale}
                searchable
                unavailable={unavailable}
                note={view.state === 'OK' ? (
                  <>
                    <span>{t('breakdowns.syntheticNote')}</span>
                    {view.selectedMeta?.rawOnly && <><br />{t('breakdowns.rawOnlyNote')}</>}
                  </>
                ) : undefined}
              />
            </section>
          )}

          {view.state === 'OK' && analysis && (
            <section className="card">
              <div className="card-head"><h2>{t('breakdowns.findings')}</h2></div>
              <div className="cell-sub" style={{ display: 'flex', gap: 8 }}>
                <strong style={{ minWidth: 160 }}>{t('breakdowns.concentration')}</strong>
                <span><span className="status neutral">{analysis.concentration ?? '—'}</span> ({t('breakdowns.hhi')} {analysis.spendHHI ?? '—'})</span>
              </div>
              {analysis.efficiencySpread ? (
                <div className="cell-sub" style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <strong style={{ minWidth: 160 }}>{t('breakdowns.efficiency')}</strong>
                  <span>{t('breakdowns.efficiencyBest')}: {analysis.efficiencySpread.best.value} · {t('breakdowns.efficiencyWorst')}: {analysis.efficiencySpread.worst.value}</span>
                </div>
              ) : null}
              {analysis.notes.map((n, i) => (
                <p key={i} className="cell-sub" style={{ marginTop: 6 }}>{locale === 'ar' ? n.ar : n.en}</p>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
