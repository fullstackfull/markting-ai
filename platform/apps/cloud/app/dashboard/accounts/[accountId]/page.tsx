import { PageHeader, formatMoneyMinor } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { EntityLink } from '@/components/kit';
import { AnalyticsTable, type AnalyticsColumn } from '@/components/analytics-table';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection, loadWorkspaceIntelligence, loadCampaignList } from '@/lib/cloud/intelligence';
import type { CampaignRow } from '@/lib/markting/orchestrator/sections';
import { getT } from '@/lib/i18n/server';
import { RangeControl } from '@/components/range-control';
import { FreshnessBar } from '@/components/freshness-bar';
import { parseRangeParam } from '@/lib/cloud/date-range';
import { parseTableState, applyTableState, type TableColumnSpec } from '@/lib/cloud/table-state';
import { loadBusinessContext } from '@/lib/markting/business-context';

export const metadata = { title: 'Account' };

// Allowed sort keys mirror the column keys — a sort param outside this set is ignored (no injection).
const CAMPAIGN_SORTS = ['name', 'spend', 'conversions', 'ctr', 'cpa', 'roas', 'trend'] as const;

/**
 * Account Intelligence — one connected drill-down (diagnosis → pacing → anomaly → forecast → creative
 * → commerce → outcomes) for one account, composed from the orchestrator. The user does not hop across
 * unrelated modules: each leg is a section of the same composed view.
 */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId } = await params;
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const sp = await searchParams;
  const selection = parseRangeParam(typeof sp.range === 'string' ? sp.range : undefined);
  const scope = { locale, accountId } as const;
  const [brief, pacing, anomaly, forecast, creative, commerce, outcomes, breakdown, crossChannel, memory, business] = await Promise.all([
    loadWorkspaceIntelligence(tenant, 'PROFITABILITY_DECLINE', scope, selection),
    loadSection(tenant, 'PACING', scope, selection),
    loadSection(tenant, 'ANOMALY', scope, selection),
    loadSection(tenant, 'FORECAST', scope, selection),
    loadSection(tenant, 'CREATIVE_REVIEW', scope, selection),
    loadSection(tenant, 'COMMERCE_PROFIT', scope, selection),
    loadSection(tenant, 'OUTCOMES_HISTORY', scope, selection),
    loadSection(tenant, 'BREAKDOWN', scope, selection),
    loadSection(tenant, 'CROSS_CHANNEL', scope, selection),
    loadSection(tenant, 'MEMORY_CONTEXT', scope, selection),
    loadBusinessContext(tenant.organizationId),
  ]);
  const campaignList = await loadCampaignList(tenant, accountId);
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const money = (v: number, row: CampaignRow) => formatMoneyMinor(v, row.currency, locale);
  const campaignHref = (id: string) => `/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(id)}?range=${encodeURIComponent(typeof sp.range === 'string' ? sp.range : 'last_30_days')}`;
  const campaignColumns: Array<AnalyticsColumn<CampaignRow>> = [
    { key: 'name', header: { en: 'Campaign', ar: 'الحملة' }, sortable: true, render: (r) => (<><EntityLink href={campaignHref(r.id)} label={r.name} /><div className="cell-sub">{r.role}</div></>) },
    { key: 'spend', header: { en: 'Spend', ar: 'الإنفاق' }, numeric: true, sortable: true, render: (r) => money(r.spendMinor, r) },
    { key: 'conversions', header: { en: 'Conv.', ar: 'التحويلات' }, numeric: true, sortable: true, render: (r) => String(r.conversions) },
    { key: 'ctr', header: { en: 'CTR', ar: 'CTR' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => `${r.ctr}%` },
    { key: 'cpa', header: { en: 'CPA', ar: 'CPA' }, numeric: true, sortable: true, render: (r) => money(r.cpaMinor, r) },
    { key: 'roas', header: { en: 'ROAS', ar: 'ROAS' }, numeric: true, sortable: true, render: (r) => `${r.roas}×` },
    { key: 'spendShare', header: { en: 'Spend %', ar: 'الإنفاق %' }, numeric: true, render: (r) => `${r.spendSharePct}%` },
    { key: 'trend', header: { en: 'CPA trend', ar: 'اتجاه CPA' }, sortable: true, render: (r) => <span className={`status ${r.trendDir === 'up' && r.trendState !== 'NOISE' ? 'warn' : 'neutral'}`}>{r.trendDir} / {r.trendState}</span> },
  ];
  const campaignSpecs: Array<TableColumnSpec<CampaignRow>> = [
    { key: 'name', searchText: (r) => `${r.name} ${r.role}`, sortValue: (r) => r.name },
    { key: 'spend', numeric: true, sortValue: (r) => r.spendMinor },
    { key: 'conversions', numeric: true, sortValue: (r) => r.conversions },
    { key: 'ctr', numeric: true, sortValue: (r) => r.ctr },
    { key: 'cpa', numeric: true, sortValue: (r) => r.cpaMinor || null },
    { key: 'roas', numeric: true, sortValue: (r) => r.roas },
    { key: 'trend', numeric: true, sortValue: (r) => r.trendScore },
  ];
  const campaignState = parseTableState(sp, { prefix: 'c', defaultSort: 'spend', defaultDir: 'desc', allowedSorts: CAMPAIGN_SORTS });
  const campaignPage = applyTableState(campaignList, campaignState, campaignSpecs);
  const card = (titleEn: string, titleAr: string, a: typeof pacing) => (
    <section className="card" style={{ marginBottom: 12 }}>
      <div className="card-head"><h2>{L(titleEn, titleAr)}</h2></div>
      {a.section ? <SectionView section={a.section} locale={locale} /> : <p className="cell-sub">—</p>}
    </section>
  );
  return (
    <main className="page">
      <PageHeader title={L('Account Intelligence', 'ذكاء الحساب')} description={accountId} />
      <RangeControl />
      <FreshnessBar selection={selection} timezone={business.timezone.value} source={brief.source} live={brief.result.trust.live} locale={locale} />
      <IntelMeta locale={locale} trustTier={brief.trustTier} live={brief.result.trust.live} source={brief.source} />
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Diagnosis', 'التشخيص')}</h2><span className={`status ${brief.nextAction === 'ATTENTION' ? 'critical' : 'warn'}`}>{brief.nextAction}</span></div><p style={{ whiteSpace: 'pre-line' }}>{locale === 'ar' ? brief.text.ar : brief.text.en}</p></section>
      {campaignList.length > 0 && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><h2>{L('Campaigns', 'الحملات')}</h2></div>
          <AnalyticsTable
            prefix="c"
            caption={{ en: 'Campaigns for this account', ar: 'حملات هذا الحساب' }}
            columns={campaignColumns}
            page={campaignPage}
            state={campaignState}
            rowKey={(r) => r.id}
            locale={locale}
            searchable
          />
        </section>
      )}
      {card('Pacing', 'الوتيرة', pacing)}
      {card('Anomalies', 'الشذوذ', anomaly)}
      {card('Forecast', 'التوقّع', forecast)}
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Creatives', 'الإعلانات')}</h2></div><div className="table-wrap">{creative.section && <SectionView section={creative.section} locale={locale} />}</div></section>
      {card('Commerce & profit', 'التجارة والربح', commerce)}
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Breakdowns', 'التصنيفات')}</h2></div>{breakdown.section && <SectionView section={breakdown.section} locale={locale} />}</section>
      {card('Cross-channel', 'عبر القنوات', crossChannel)}
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Business context & memory', 'سياق العمل والذاكرة')}</h2></div><div className="table-wrap">{memory.section && <SectionView section={memory.section} locale={locale} />}</div></section>
      <section className="card"><div className="card-head"><h2>{L('Recent decisions & outcomes', 'القرارات والنتائج الأخيرة')}</h2></div><div className="table-wrap">{outcomes.section && <SectionView section={outcomes.section} locale={locale} />}</div></section>
    </main>
  );
}
