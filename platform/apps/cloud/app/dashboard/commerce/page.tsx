import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Commerce' };

export default async function CommercePage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const a = await loadSection(tenant, 'COMMERCE_PROFIT', { locale });
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  return (
    <main className="page">
      <PageHeader title={L('Commerce & Profit', 'التجارة والربح')} description={L('Merchant net revenue, refunds, MER, contribution margin and platform-vs-merchant reconciliation. Profit is withheld (UNKNOWN) when COGS is unknown — never inferred.', 'صافي إيراد المتجر والاستردادات وMER وهامش المساهمة وتسوية المنصّة مقابل المتجر. يُحجب الربح (غير معروف) عند جهل COGS — لا يُستنتج.')} />
      <IntelMeta locale={locale} trustTier={a.trustTier} live={a.result.trust.live} source={a.source} />
      <section className="card">
        <div className="card-head"><h2>{L('Profit intelligence', 'ذكاء الربح')}</h2></div>
        {a.section?.kind === 'commerce' && <SectionView section={a.section} locale={locale} />}
        <p className="cell-sub" style={{ marginTop: 10 }}>{locale === 'ar' ? a.text.ar : a.text.en}</p>
      </section>
    </main>
  );
}
