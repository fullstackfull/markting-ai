import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, formatMoneyMinor } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { EntityLink } from '@/components/kit';
import { AnalyticsTable, type AnalyticsColumn, type ColumnPreset } from '@/components/analytics-table';
import { PacingChart, BarChart } from '@/components/charts';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { authorizeTenantAccount } from '@/lib/cloud/account-authz';
import { decodeParams } from '@/lib/cloud/route-params';
import { loadCampaign, loadSection, loadAdGroupList } from '@/lib/cloud/intelligence';
import type { AdGroupRow } from '@/lib/markting/orchestrator/sections';
import { getT } from '@/lib/i18n/server';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { RangeControl } from '@/components/range-control';
import { FreshnessBar } from '@/components/freshness-bar';
import { parseRangeParam } from '@/lib/cloud/date-range';
import { parseTableState, applyTableState, type TableColumnSpec } from '@/lib/cloud/table-state';
import { loadBusinessContext } from '@/lib/markting/business-context';
import { adGroupTerm } from '@/lib/connections/registry';

export const metadata = { title: 'Campaign' };

// Allowed sort keys mirror the column keys — a sort param outside this set is ignored (no injection).
const GROUP_SORTS = ['name', 'status', 'spend', 'impressions', 'clicks', 'ctr', 'cpa', 'conversions', 'roas', 'spendShare'] as const;

/**
 * Campaign Intelligence — the media-buyer drill-down for one campaign, composed from the orchestrator
 * (no independent campaign analytics): KPIs, current-vs-previous, pacing, CPA trend, scaling readiness,
 * an AnalyticsTable of its ad sets / ad groups (provider-native naming), creative health, plus an
 * experiment entry point. Range + freshness are wired exactly like the account page (Phase A).
 */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ accountId: string; campaignId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { accountId, campaignId } = decodeParams(await params);
  const tenant = await requireDashboardTenant();
  await authorizeTenantAccount(tenant, accountId);
  const { t, locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const sp = await searchParams;
  const rangeRaw = typeof sp.range === 'string' ? sp.range : undefined;
  const selection = parseRangeParam(rangeRaw);
  const [section, outcomes, groupList, business] = await Promise.all([
    loadCampaign(tenant, accountId, campaignId),
    loadSection(tenant, 'OUTCOMES_HISTORY', { locale, accountId }, selection),
    loadAdGroupList(tenant, accountId, campaignId),
    loadBusinessContext(tenant.organizationId),
  ]);
  const demo = resolveRuntimeMode() === 'DEMO';
  // C0.1/C0.3 — DEMO seed is the complete universe; a not-found campaign means the account▸campaign
  // chain does not hold (wrong-parent URL guess or unknown id) → true 404, never a cross-tenant oracle.
  if (demo && !section.found) notFound();
  const term = adGroupTerm(groupList.providerId || 'sandbox');
  const termLabel = L(term.en, term.ar);

  const groupHref = (id: string) => `/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(campaignId)}/groups/${encodeURIComponent(id)}?range=${encodeURIComponent(rangeRaw ?? 'last_30_days')}`;
  const money = (v: number, row: AdGroupRow) => formatMoneyMinor(v, row.currency, locale);
  const groupColumns: Array<AnalyticsColumn<AdGroupRow>> = [
    { key: 'name', header: { en: termLabel, ar: termLabel }, sortable: true, render: (r) => <EntityLink href={groupHref(r.id)} label={r.name} /> },
    { key: 'type', header: { en: 'Type', ar: 'النوع' }, render: () => termLabel },
    { key: 'status', header: { en: 'Status', ar: 'الحالة' }, sortable: true, render: (r) => <span className={`status ${r.status === 'active' ? '' : 'neutral'}`}>{r.status}</span> },
    { key: 'spend', header: { en: 'Spend', ar: 'الإنفاق' }, numeric: true, sortable: true, render: (r) => money(r.spendMinor, r) },
    { key: 'impressions', header: { en: 'Impressions', ar: 'الظهور' }, numeric: true, sortable: true, render: (r) => String(r.impressions) },
    { key: 'clicks', header: { en: 'Clicks', ar: 'النقرات' }, numeric: true, sortable: true, render: (r) => String(r.clicks) },
    { key: 'ctr', header: { en: 'CTR', ar: 'CTR' }, numeric: true, sortable: true, defaultVisible: false, render: (r) => `${r.ctr}%` },
    { key: 'cpa', header: { en: 'CPA', ar: 'CPA' }, numeric: true, sortable: true, render: (r) => money(r.cpaMinor, r) },
    { key: 'conversions', header: { en: 'Conv.', ar: 'التحويلات' }, numeric: true, sortable: true, render: (r) => String(r.conversions) },
    { key: 'roas', header: { en: 'ROAS', ar: 'ROAS' }, numeric: true, sortable: true, render: (r) => `${r.roas}×` },
    { key: 'spendShare', header: { en: 'Spend %', ar: 'الإنفاق %' }, numeric: true, sortable: true, render: (r) => `${r.spendSharePct}%` },
  ];
  const groupSpecs: Array<TableColumnSpec<AdGroupRow>> = [
    { key: 'name', searchText: (r) => `${r.name} ${r.entityType} ${r.status}`, sortValue: (r) => r.name },
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
  const groupPresets: ColumnPreset[] = [
    { id: 'performance', label: { en: 'Performance', ar: 'الأداء' }, keys: ['name', 'type', 'spend', 'impressions', 'clicks', 'conversions', 'roas'] },
    { id: 'efficiency', label: { en: 'Efficiency', ar: 'الكفاءة' }, keys: ['name', 'type', 'spend', 'cpa', 'ctr', 'roas', 'spendShare'] },
    { id: 'delivery', label: { en: 'Delivery', ar: 'التسليم' }, keys: ['name', 'type', 'status', 'impressions', 'clicks', 'ctr'] },
  ];
  const groupState = parseTableState(sp, { prefix: 'g', defaultSort: 'spend', defaultDir: 'desc', allowedSorts: GROUP_SORTS });
  const groupPage = applyTableState(groupList.rows, groupState, groupSpecs);
  // B22 — distinguish an explicitly unavailable level (live/unsupported) from merely empty (NO_DATA).
  const groupUnavailable = groupList.state === 'NOT_CONNECTED'
    ? { title: t('adgroups.notConnectedTitle'), reason: t('adgroups.notConnectedCopy') }
    : groupList.state === 'NOT_SUPPORTED_BY_PROVIDER'
    ? { title: t('adgroups.unsupportedTitle'), reason: t('adgroups.unsupportedCopy') }
    : undefined;

  return (
    <main className="page">
      <PageHeader title={section.found ? (section.name ?? L('Campaign', 'الحملة')) : L('Campaign', 'الحملة')} description={`${accountId} · ${campaignId}`} />
      <p className="cell-sub" style={{ marginTop: -6, marginBottom: 8 }}>
        <Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}?range=${encodeURIComponent(rangeRaw ?? 'last_30_days')}`} prefetch={false}>{L('Account', 'الحساب')}</Link>
        {' ▸ '}<span>{section.name ?? campaignId}</span>
      </p>
      <RangeControl />
      <FreshnessBar selection={selection} timezone={business.timezone.value} source="DETERMINISTIC_ONLY" live={!demo} locale={locale} />
      <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{t('adgroups.performance')}</h2></div>
        <SectionView section={section} locale={locale} />
      </section>
      {section.found && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><h2>{L('Charts', 'الرسوم')}</h2></div>
          {section.pacing && <PacingChart title={L('Pacing', 'الوتيرة')} elapsedPct={section.pacing.expectedFraction * 100} spentPct={section.pacing.actualFraction * 100} locale={locale} />}
          {section.comparison && (
            <div style={{ marginTop: 10 }}>
              <BarChart title={t('adgroups.comparison')} twoSeries bars={section.comparison.flatMap((c) => [{ label: `${c.metric} (cur)`, value: c.to, group: 'current' as const }, { label: `${c.metric} (prev)`, value: c.from, group: 'previous' as const }])} locale={locale} />
            </div>
          )}
        </section>
      )}
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{termLabel}</h2><span className="card-note">{t('adgroups.groupsSection')}</span></div>
        <AnalyticsTable
          prefix="g"
          caption={{ en: `${termLabel} for this campaign`, ar: `${termLabel} لهذه الحملة` }}
          columns={groupColumns}
          page={groupPage}
          state={groupState}
          rowKey={(r) => r.id}
          locale={locale}
          searchable
          presets={groupPresets}
          unavailable={groupUnavailable}
        />
      </section>
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Creative health', 'صحة الإبداع')}</h2></div>
        {section.found && section.creatives && section.creatives.length > 0
          ? <div className="table-wrap"><table><thead><tr><th>{L('Creative', 'الإعلان')}</th><th>{L('State', 'الحالة')}</th><th>{L('Fatigue', 'الإجهاد')}</th><th>CTR</th></tr></thead><tbody>{section.creatives.map((cr) => <tr key={cr.id}><td><Link href={`/dashboard/creative/${cr.id}`} prefetch={false}>{cr.name}</Link></td><td>{cr.state}</td><td>{cr.fatigue}</td><td>{cr.ctr}%</td></tr>)}</tbody></table></div>
          : <p className="cell-sub">{L('No creative data for this campaign.', 'لا بيانات إبداعية لهذه الحملة.')}</p>}
      </section>
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Recent decisions & outcomes', 'القرارات والنتائج')}</h2></div>
        <div className="table-wrap">{outcomes.section && <SectionView section={outcomes.section} locale={locale} />}</div>
      </section>
      <section className="card">
        <Link href="/dashboard/experiments" prefetch={false} className="card-note">{L('Design an experiment for this campaign →', 'صمّم تجربة لهذه الحملة ←')}</Link>
      </section>
    </main>
  );
}
