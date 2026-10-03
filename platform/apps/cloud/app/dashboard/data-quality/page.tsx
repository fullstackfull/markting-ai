import { PageHeader } from '@/components/ui';
import { SectionView, IntelMeta } from '@/components/intel';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { loadSection } from '@/lib/cloud/intelligence';
import { getT } from '@/lib/i18n/server';

export const metadata = { title: 'Data Quality' };

export default async function DataQualityPage() {
  const tenant = await requireDashboardTenant();
  const { locale } = await getT();
  const a = await loadSection(tenant, 'DATA_QUALITY', { locale });
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  return (
    <main className="page">
      <PageHeader title={L('Data Quality Center', 'مركز جودة البيانات')} description={L('Stale sync, missing COGS, attribution mismatch, insufficient evidence — data problems that must not be mistaken for business-performance problems.', 'مزامنة قديمة، COGS مفقود، عدم تطابق الإسناد، أدلة غير كافية — مشكلات بيانات يجب ألا تُخلط مع أداء العمل.')} />
      <IntelMeta locale={locale} trustTier={a.trustTier} live={a.result.trust.live} source={a.source} />
      <section className="card">{a.section?.kind === 'dataQuality' && <SectionView section={a.section} locale={locale} />}</section>
    </main>
  );
}
