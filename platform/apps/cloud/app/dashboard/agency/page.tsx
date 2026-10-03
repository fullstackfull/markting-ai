import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Agency' };

export default async function AgencyPage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const a = await loadSection(tenant, 'PORTFOLIO_ATTENTION', { locale });
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  return (
    <main className="page">
      <PageHeader title={L('Agency Portfolio', 'محفظة الوكالة')} description={L('Which client needs attention first, ranked by a deterministic materiality/risk score. Currencies are never blended into one fake total.', 'أي عميل يحتاج الانتباه أولًا، مرتبًا بدرجة أهمية/مخاطرة حتمية. لا تُدمج العملات في إجمالي واحد زائف.')} />
      <IntelMeta locale={locale} trustTier={a.trustTier} live={a.result.trust.live} source={a.source} />
      <section className="card">
        <div className="card-head"><h2>{L('Client health queue', 'قائمة صحة العملاء')}</h2></div>
        <div className="table-wrap">{a.section?.kind === 'portfolio' && <SectionView section={a.section} locale={locale} />}</div>
      </section>
    </main>
  );
}
