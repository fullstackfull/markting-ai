import Link from 'next/link';
import { PageHeader, formatMoneyMinor } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { EntityLink, MetricCard, EvidenceCard, StatusChip } from '@/components/kit';
import { BarChart } from '@/components/charts';
import { AnalyticsTable, type AnalyticsColumn, type ColumnPreset } from '@/components/analytics-table';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadAdGroup, loadSection } from '@/lib/cloud/intelligence';
import type { AdRow } from '@/lib/markting/orchestrator/sections';
import { getT } from '@/lib/i18n/server';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { RangeControl } from '@/components/range-control';
import { FreshnessBar } from '@/components/freshness-bar';
import { parseRangeParam } from '@/lib/cloud/date-range';
import { parseTableState, applyTableState, type TableColumnSpec } from '@/lib/cloud/table-state';
import { loadBusinessContext } from '@/lib/markting/business-context';
import { adGroupTerm } from '@/lib/connections/registry';

export const metadata = { title: 'Ad set / ad group' };

const AD_SORTS = ['name', 'status', 'spend', 'impressions', 'clicks', 'ctr', 'cpa', 'conversions', 'roas', 'spendShare'] as const;

/**
 * PHASE B (B8) — ad set / ad group detail. Parent breadcrumb (account ▸ campaign), the provider-native
 * level label (adGroupTerm), KPI cards, current-vs-previous comparison, CPA trend, an AnalyticsTable of
 * its ads (sortable, prefix 'ad'), an evidence-backed deterministic diagnosis + EvidenceCard, and a
 * data-quality note. DEMO reads the orchestrator seed; a live deployment returns the honest not-connected
 * state exactly like loadCampaign.
 */
export default async function AdGroupPage({ params, searchParams }: { params: Promise<{ accountId: string; campaignId: string; groupId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId, campaignId, groupId } = await params;
  const tenant = await requireDashboardTenant();
  const { t, locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const T = (b: { en: string; ar: string }) => (locale === 'ar' ? b.ar : b.en);
  const sp = await searchParams;
  const rangeRaw = typeof sp.range === 'string' ? sp.range : undefined;
  const selection = parseRangeParam(rangeRaw);
  const [section, dataQuality, business] = await Promise.all([
    loadAdGroup(tenant, accountId, campaignId, groupId),
    loadSection(tenant, 'DATA_QUALITY', { locale, accountId }, selection),
    loadBusinessContext(tenant.organizationId),
  ]);
  const demo = resolveRuntimeMode() === 'DEMO';
  const providerId = ('providerId' in section ? section.providerId : undefined) || 'sandbox';
  const term = adGroupTerm(providerId);
  const termLabel = L(term.en, term.ar);
  const rq = encodeURIComponent(rangeRaw ?? 'last_30_days');

  const breadcrumb = (
    <p className="cell-sub" style={{ marginTop: -6, marginBottom: 8 }}>
      <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}?range=${rq}`} prefetch={false}>{L('Account', 'الحساب')}</Link>
      {' ▸ '}
      <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(campaignId)}?range=${rq}`} prefetch={false}>{section.found ? (section.campaignName ?? L('Campaign', 'الحملة')) : L('Campaign', 'الحملة')}</Link>
      {' ▸ '}<span>{section.found ? section.name : groupId}</span>
    </p>
  );

  if (!section.found) {
    return (
      <main className="page">
        <PageHeader title={termLabel} description={`${accountId} · ${campaignId}`} />
        {breadcrumb}
        <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />
        <section className="card"><div className="blocked-state" role="note"><strong>{t('adgroups.notConnectedTitle')}</strong><p className="cell-sub">{T(section.summary)}</p></div></section>
      </main>
    );
  }

  const adHref = (id: string) => `/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(campaignId)}/groups/${encodeURIComponent(groupId)}/ads/${encodeURIComponent(id)}?range=${rq}`;
  const money = (v: number, row: AdRow) => formatMoneyMinor(v, row.currency, locale);
  const adColumns: Array<AnalyticsColumn<AdRow>> = [
    { key: 'name', header: { en: 'Ad', ar: 'الإعلان' }, sortable: true, render: (r) => <EntityLink href={adHref(r.id)} label={r.name} /> },
    { key: 'status', header: { en: 'Status', ar: 'الحالة' }, sortable: true, render: (r) => <span className={`status ${r.status === 'active' ? '' : 'neutral'}`}>{r.status}</span> },
    { key: 'spend', header: { en: 'Spend', ar: 'الإنفاق' }, numeric: true, sortable: true, render: (r) => money(r.spendMinor, r) },
    { key: 'impressions', header: { en: 'Impressions', ar: 'الظهور' }, numeric: true, sortable: true, render: (r) => String(r.impressions) },
    { key: 'clicks', header: { en: 'Clicks', ar: 'النقرات' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => String(r.clicks) },
    { key: 'ctr', header: { en: 'CTR', ar: 'CTR' }, numeric: true, sortable: true, render: (r) => `${r.ctr}%` },
    { key: 'cpa', header: { en: 'CPA', ar: 'CPA' }, numeric: true, sortable: true, render: (r) => money(r.cpaMinor, r) },
    { key: 'conversions', header: { en: 'Conv.', ar: 'التحويلات' }, numeric: true, sortable: true, render: (r) => String(r.conversions) },
    { key: 'roas', header: { en: 'ROAS', ar: 'ROAS' }, numeric: true, sortable: true, render: (r) => `${r.roas}×` },
    { key: 'spendShare', header: { en: 'Spend %', ar: 'الإنفاق %' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => `${r.spendSharePct}%` },
  ];
  const adSpecs: Array<TableColumnSpec<AdRow>> = [
    { key: 'name', searchText: (r) => `${r.name} ${r.status}`, sortValue: (r) => r.name },
    { key: 'status', sortValue: (r) => r.status },
    { key: 'spend', numeric: true, sortValue: (r) => r.spendMinor },
    { key: 'impressions', numeric: true, sortValue: (r) => r.impressions },
    { key: 'clicks', numeric: true, sortValue: (r) => r.clicks },
    { key: 'ctr', numeric: true, sortValue: (r) => r.ctr },
    { key: 'cpa', numeric: true, sortValue: (r) => r.cpaMinor || null },
    { key: 'conversions', numeric: true, sortValue: (r) => r.conversions },
    { key: 'roas', numeric: true, sortValue: (r) => r.roas },
    { key: 'spendShare', numeric: true, sortValue: (r) => r.spendSharePct },
  ];
  const adPresets: ColumnPreset[] = [
    { id: 'performance', label: { en: 'Performance', ar: 'الأداء' }, keys: ['name', 'spend', 'impressions', 'conversions', 'roas'] },
    { id: 'efficiency', label: { en: 'Efficiency', ar: 'الكفاءة' }, keys: ['name', 'spend', 'cpa', 'ctr', 'roas', 'spendShare'] },
    { id: 'delivery', label: { en: 'Delivery', ar: 'التسليم' }, keys: ['name', 'status', 'impressions', 'clicks', 'ctr'] },
  ];
  const adState = parseTableState(sp, { prefix: 'ad', defaultSort: 'spend', defaultDir: 'desc', allowedSorts: AD_SORTS });
  const adPage = applyTableState(section.ads ?? [], adState, adSpecs);

  const k = section.kpis!;
  const cur = section.currency;
  const m = (v: number) => formatMoneyMinor(v, cur, locale);

  return (
    <main className="page">
      <PageHeader title={section.name ?? termLabel} description={`${termLabel} · ${section.status}`} />
      {breadcrumb}
      <RangeControl />
      <FreshnessBar selection={selection} timezone={business.timezone.value} source="DETERMINISTIC_ONLY" live={!demo} locale={locale} />
      <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{t('adgroups.performance')}</h2><StatusChip tone={section.status === 'active' ? 'good' : 'neutral'} label={`${t('adgroups.type')}: ${termLabel}`} /></div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <MetricCard label={L('Spend', 'الإنفاق')} value={m(k.spendMinor)} />
          <MetricCard label={L('Conversions', 'التحويلات')} value={String(k.conversions)} />
          <MetricCard label="CPA" value={m(k.cpaMinor)} />
          <MetricCard label="ROAS" value={`${k.roas}×`} />
          <MetricCard label="CTR" value={`${k.ctr}%`} />
          <MetricCard label="CPM" value={m(k.cpmMinor)} />
          <MetricCard label="CPC" value={m(k.cpcMinor)} />
        </div>
        <p className="cell-sub" style={{ marginTop: 8 }}>{t('adgroups.trend')}: {section.trend?.direction} / {section.trend?.state}</p>
      </section>

      {section.comparison && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><h2>{t('adgroups.comparison')}</h2></div>
          <BarChart title={t('adgroups.comparison')} twoSeries bars={section.comparison.flatMap((c) => [{ label: `${c.metric} (cur)`, value: c.to, group: 'current' as const }, { label: `${c.metric} (prev)`, value: c.from, group: 'previous' as const }])} locale={locale} />
        </section>
      )}

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{t('adgroups.adsSection')}</h2></div>
        <AnalyticsTable
          prefix="ad"
          caption={{ en: 'Ads in this ad set / ad group', ar: 'إعلانات هذه المجموعة الإعلانية' }}
          columns={adColumns}
          page={adPage}
          state={adState}
          rowKey={(r) => r.id}
          locale={locale}
          searchable
          presets={adPresets}
        />
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{t('adgroups.diagnosis')}</h2></div>
        <p>{section.diagnosis ? T(section.diagnosis) : '—'}</p>
        {section.evidence && section.evidence.length > 0 && (
          <EvidenceCard title={t('adgroups.evidenceTitle')}>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>{section.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </EvidenceCard>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>{t('adgroups.dataQualityNote')}</h2></div>
        {dataQuality.section ? <SectionView section={dataQuality.section} locale={locale} /> : <p className="cell-sub">—</p>}
      </section>
    </main>
  );
}
