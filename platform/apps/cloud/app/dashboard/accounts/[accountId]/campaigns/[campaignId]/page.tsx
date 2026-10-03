import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadCampaign, loadSection } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';
import { resolveRuntimeMode } from '@/lib/markting/runtime-mode';

export const metadata = { title: 'Campaign' };

/**
 * Campaign Intelligence — the media-buyer drill-down for one campaign, composed from the orchestrator
 * (no independent campaign analytics): KPIs, current-vs-previous, pacing, CPA trend, scaling readiness,
 * creative health, plus an experiment entry point. Consumes loadCampaign (campaign-scoped section).
 */
export default async function CampaignPage({ params }: { params: Promise<{ accountId: string; campaignId: string }> }) {
  const { accountId, campaignId } = await params;
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const section = await loadCampaign(tenant, accountId, campaignId);
  const outcomes = await loadSection(tenant, 'OUTCOMES_HISTORY', { locale, accountId });
  const demo = resolveRuntimeMode() === 'DEMO';
  return (
    <main className="page">
      <PageHeader title={section.found ? (section.name ?? L('Campaign', 'الحملة')) : L('Campaign', 'الحملة')} description={`${accountId} · ${campaignId}`} />
      <IntelMeta locale={locale} trustTier={demo ? 'SYNTHETIC' : 'UNVERIFIED'} live={!demo} source="DETERMINISTIC_ONLY" />
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Performance & health', 'الأداء والصحة')}</h2></div>
        <SectionView section={section} locale={locale} />
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
