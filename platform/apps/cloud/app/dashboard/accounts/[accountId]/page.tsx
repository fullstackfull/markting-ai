import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection, loadWorkspaceIntelligence } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Account' };

/**
 * Account Intelligence — one connected drill-down (diagnosis → pacing → anomaly → forecast → creative
 * → commerce → outcomes) for one account, composed from the orchestrator. The user does not hop across
 * unrelated modules: each leg is a section of the same composed view.
 */
export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const scope = { locale, accountId } as const;
  const [brief, pacing, anomaly, forecast, creative, commerce, outcomes, breakdown, crossChannel, memory] = await Promise.all([
    loadWorkspaceIntelligence(tenant, 'PROFITABILITY_DECLINE', scope),
    loadSection(tenant, 'PACING', scope),
    loadSection(tenant, 'ANOMALY', scope),
    loadSection(tenant, 'FORECAST', scope),
    loadSection(tenant, 'CREATIVE_REVIEW', scope),
    loadSection(tenant, 'COMMERCE_PROFIT', scope),
    loadSection(tenant, 'OUTCOMES_HISTORY', scope),
    loadSection(tenant, 'BREAKDOWN', scope),
    loadSection(tenant, 'CROSS_CHANNEL', scope),
    loadSection(tenant, 'MEMORY_CONTEXT', scope),
  ]);
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
      <IntelMeta locale={locale} trustTier={brief.trustTier} live={brief.result.trust.live} source={brief.source} />
      <section className="card" style={{ marginBottom: 12 }}><div className="card-head"><h2>{L('Diagnosis', 'التشخيص')}</h2><span className={`status ${brief.nextAction === 'ATTENTION' ? 'critical' : 'warn'}`}>{brief.nextAction}</span></div><p style={{ whiteSpace: 'pre-line' }}>{locale === 'ar' ? brief.text.ar : brief.text.en}</p></section>
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
