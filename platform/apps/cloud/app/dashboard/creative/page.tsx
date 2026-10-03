import { PageHeader, Empty } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Creative' };

export default async function CreativePage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const a = await loadSection(tenant, 'CREATIVE_REVIEW', { locale });
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  return (
    <main className="page">
      <PageHeader title={L('Creative Library', 'مكتبة الإبداع')} description={L('Creative health, fatigue watch, hooks and concentration — contributes to campaign diagnosis, not a separate silo.', 'صحة الإبداع ومراقبة الإجهاد والعناوين والتركّز — تساهم في تشخيص الحملة وليست صومعة منفصلة.')} />
      <IntelMeta locale={locale} trustTier={a.trustTier} live={a.result.trust.live} source={a.source} />
      <section className="card">
        {a.section?.kind === 'creative' && a.section.rows.length > 0
          ? <><div className="card-head"><h2>{L('Creatives', 'الإعلانات')}</h2><span className="card-note">{a.section.summary.en && (locale === 'ar' ? a.section.summary.ar : a.section.summary.en)}</span></div><div className="table-wrap"><SectionView section={a.section} locale={locale} /></div></>
          : <Empty title={L('No creatives', 'لا إعلانات')} copy={L('Connect a provider with creative data to populate the library.', 'اربط مزوّدًا يحتوي بيانات إبداعية لملء المكتبة.')} />}
      </section>
    </main>
  );
}
