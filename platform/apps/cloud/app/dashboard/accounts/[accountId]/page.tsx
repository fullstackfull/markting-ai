import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import Link from 'next/link';
import { loadSection, loadWorkspaceIntelligence, loadCampaignList } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';
import { RangeControl } from '@/components/range-control';
import { FreshnessBar } from '@/components/freshness-bar';
import { parseRangeParam } from '@/lib/cloud/date-range';
import { loadBusinessContext } from '@/lib/markting/business-context';

export const metadata = { title: 'Account' };

/**
 * Account Intelligence — one connected drill-down (diagnosis → pacing → anomaly → forecast → creative
 * → commerce → outcomes) for one account, composed from the orchestrator. The user does not hop across
 * unrelated modules: each leg is a section of the same composed view.
 */
export default async function AccountPage({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ range?: string }> }) {
  const { accountId } = await params;
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const selection = parseRangeParam((await searchParams).range);
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
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>{campaignList.map((c) => <li key={c.id}><Link href={`/dashboard/accounts/${encodeURIComponent(accountId)}/campaigns/${encodeURIComponent(c.id)}`} prefetch={false}>{c.name}</Link></li>)}</ul>
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
